# CATALOG-BUILDOUT.md

Roadmap for implementing the full ~2100-card catalog in the data-driven
engine. The pick-up point for a future session.

> Per-card status is tracked in `data/card-coverage.json` (source of truth)
> and the generated `COVERAGE.md`. The workflow is in `BEHAVIORS.md` →
> "Coverage workflow". This file is the roadmap: current state, the per-set
> loop, what's left, and the open engine boundaries.

---

## Current state

| | count |
|---|--:|
| Catalog total | 2101 |
| `verified` (driven through the public API) | 1743 |
| `authored` (behavior JSON written, fixture-tested by shape) | 207 |
| `classified` (audited, not yet authored) | 0 |
| `vanilla` (no behavior needed) | 149 |
| `unclassified` | **0** |
| `wontImplement` | 2 |
| `rulesAudited` | 2101 / 2101 |
| Engine capabilities | 219 / 219 implemented |
| Test suite | 2310 passing (`npm test`), `npm run typecheck` clean |

**Every set is now classified.** Ten sets are 100% done (Seed 3, 1st Edition
Part 2, Holy Heist, Ungodly Mess, Open Beta, 1st Edition, Seed, 2nd Edition,
**Seed Saga**, plus Seed 3's faction cards). The only remaining work is
promoting the **207 `authored` Seed 2 + SotDE** cards to `verified` — their
behaviour JSON is written and shape-proven by the per-capability fixtures +
`card-data-integrity`; each just needs driving through a real-JSON
smoke/exercise path (copy `seed-saga-exercise.test.ts`, swap the `set===`
filter to `"Seed 2"` / `"Shade of the Devoured Emperor"`, fix whatever the
harness surfaces). No new capabilities are expected.

**Seed Saga (358 cards) — done** (13 `vanilla` + 345 `verified`). ~89%
reprint: `.work/author-ss-reprints.cjs` copied 305 cards that name+text-match
an earlier card (220 of `verified` cards, 85 of the still-`authored` Seed 2 /
SotDE cards — the latter are legitimately promoted to `verified` here because
`seed-saga-exercise.test.ts` drives them through the public API, the same bar
every set used). `.work/author-ss-novel.cjs` authored the **40 genuinely-novel
cards** (the Gideon / Demon Knights / Imperial Army / Mau / Banner era) —
**zero new capabilities**, every shape composed from the existing 219-cap
vocabulary. Notable reuse: RECUR (`activationZone:"discard"` + `removeFromGame`),
enters-with-tokens + `counter`→stat (Hungermaw / Caracal / Undead Sword /
Brotherhood of the Mau), the Crest-of-* dual-trigger template for the 5
Banners (`resourcePlayed` + `cardEnteredPlay` + `cardProvides` + `mayPay` +
"BURN IT"), `distributeAmong` over an auto-filled party declaration
(Draconarius, Ambuscade idiom), `installReplacement` (Elzibeth),
self-scoped `{isCard}` `replacement` on `destroy` + `moveToZone zone:"removed"`
(Goutflame, Adriel), `fromFaceDown` REUSE abilities (Invade!, The Emperor
Born), `suppressAllAbilities` selector (Mud Prison), `scheduleEffect
:"startOfNextTurn"` + `{remembered}` (Imperial Palace),
`grantKeywordToPlayer` (Crushjaw Oceanhide), `chooserSelectsNumber` + `mayPay`
for a player-chosen "pay X" (Brotherhood of the Mau). **Concessions** (each in
the card's coverage `notes`): "pick a player" collapses to "the opponent" in
2-player (Arcane Monkey Ritual, Gideon's Legacy, Well Laid Plans, Enter The
Demon Knights); Ecneret's "by an opposing card" + "until end of your next
turn" both approximated; Lecram / Gilda "look at the top card" is a no-op
(no hidden-information model, RULES §5); Runic Flee's FLIP-UP bonus resource
play unmodelled; Draconarius reads `printedStat` for "this card's strength"
in its own death trigger. Test coverage: `seed-saga-exercise.test.ts` (all
352 behaviour-bearing SS cards survive the engine) +
`seed-saga-smoke.test.ts` (10 hand-written scenarios: Hungermaw, Undead
Sword, Mutilated, Duskfall Buckgriff, The Enemy's Head, Executive Order,
Banner of Fury, Crushjaw Oceanhide, Invade!, Elzibeth). No spoils-game
wiring needed (no new `PendingChoice` kind / `Cost` shape / event).

**2nd Edition (300 cards) — done** (19 `vanilla` + 281 `verified`). A
**pure reprint set**: every non-vanilla card is a name+text match of an
already-`verified` card in 1st Edition / 1st Edition Part 2, so
`.work/author-2e.cjs` copied each source's `behavior` (+ `attachTo` /
`flipUp` / `unique` / `selfDisposition` siblings — 12 gear items needed an
`attachTo: "character"` backfill the 2E import had dropped) and mirrored its
coverage classification verbatim, appending a provenance note. **Zero new
capabilities.** Test coverage: `second-edition-exercise.test.ts` (every
behaviour-bearing 2E card instantiated from the catalog and played /
activated / triggered on a broad synthetic board, every pending choice
auto-answered) + `second-edition-smoke.test.ts` (8 hand-written end-to-end
scenarios — Clandestine Resort aura, Land Shark scaling, Armored Keep
`preventsDefeat`, Gold Summit draw→influence, Dragon Juice, Ministry of
Other Smaller Ministries attack tax, 12 Man Brunch of Doom, Air Travel). No
spoils-game wiring needed (no new `PendingChoice` kind / `Cost` shape /
event — all inherited from the 1st Edition sets).

**Seed (231 cards) — done** (17 `vanilla` + 214 `verified`). Only ~4 exact
reprints (Brainbath, Circumspect Hijacker, Multi-Attachment Man, Overindulge
from Ungodly Mess) — the rest is genuine per-card authoring, but ~95% maps
straight onto existing vocab (Seed is the oldest, simplest set). Added 9
capabilities in one pass — `preventsAttackOnFaction`, `attackLimitPerTurn`,
`mustReceiveBattleDamage` (Courageous Paladin damage magnet), `searchTax`,
`abilityCostModifiers` scope `"opponentCharacters"` (Department of
Rejections), `attackTax` `player:"activePlayer"` + `requiresAttackerMatch`
(Auspicious Tax per-character attack tax), `redirectAttackTarget` effect
(Architectural Restitution), `deployForFree.budget` total-cost pool +
`sumCost` expression (Reality Shift) — see `BEHAVIORS.md` → "Seed additions"
and `RULES.md` §12. Icon-gated triggered abilities ("[R][R][R]: At the start
of your turn, ...") are just a `condition: numberCompare(resourceIcons ...)`
— the established Seed 2 idiom, no new capability. Concessions (in card
`notes`): Lucky Charm's opponent pick-tax (unmodelled; ETB draw authored),
Titillating Contortionist's "must block *this*" (generic `mustBlock`), Runic
Battery's "detach up to X resources" (`detach` effect), Rune of Concealment
(mandatory one-shot `installReplacement`, no "you may"), Scintillating
Chamber Pot / Fiscal Intercessor (source-scoped `modifyOutgoingDamage` /
`preventDamage` shield rather than target-scoped), Surprise! (deck search
rather than top-of-deck "reveal until"). Test coverage:
`seed-caps.test.ts` (one fixture per new capability), `seed-smoke.test.ts`
(11 hand-written end-to-end scenarios through the real catalog),
`seed-exercise.test.ts` (**every** behavior-bearing card instantiated from
the catalog and played / activated / triggered on a broad synthetic board
with every pending choice auto-answered — this is why the whole set is
`verified`). No spoils-game wiring needed (no new `PendingChoice` kind,
`Cost` shape, or event).

**1st Edition (226 cards) — done** (24 `vanilla` + 202 `verified`). **144
of 162 non-vanilla cards are exact reprints** (same name + text) of
already-`verified` Open Beta cards — the authored `behavior` + coverage
classification were copied verbatim (`.work/_fe-reprints.cjs`). Only 18
cards are novel, needing 2 small capabilities: `restrict-party-effect` (the
"this turn" form of `partyRestriction` — Carnival King) and
`partyRestriction.scope: "attachedParty"` (Spiky Atlasphere). Tests:
`first-edition-{caps,smoke,exercise}.test.ts`. One concession: Resurrection
Emporium's discard→removed replacement fires only for a character leaving
play. Reuses the Open Beta `seat-swap` parity gap (Emergency Obfuscation is
also a 1st Edition reprint).

**Open Beta (206 cards) — done** (22 `vanilla` + 184 `verified`). Added 19
capabilities in one pass — `draw-count-modifier`,
`event-draw-amount-expression`, `influence-change-modifier`,
`cannot-lose-at-zero-influence`, `attack-tax`, `deploys-this-turn-count`,
`attacked-this-turn-condition`, `damaged-this-turn-any-source`,
`grant-subtype`, `redirect-hand-moves`, `install-replacement-effect`,
`foreach-sequential`, `spend-counters-menu`, `last-deployed-tactic-ref`,
`party-restriction-any-party` (maxMembers + all-parties scope),
`play-restriction-by-name`, `selector-fromtop-expression`,
`card-picked-trigger`, `activate-opponents-abilities` — see `BEHAVIORS.md` →
"Open Beta additions" and `RULES.md` §12 → "Open Beta additions". One parity
gap: `seat-swap` (Emergency Obfuscation). Test coverage:
`open-beta-caps.test.ts` (one fixture per new capability), `open-beta-smoke.test.ts`
(13 hand-written end-to-end scenarios through the real catalog),
`open-beta-exercise.test.ts` (**every** card with a `behavior` block —
including the 40 prior-pass ones — instantiated from the catalog and played /
activated / triggered on a broad synthetic board with every pending choice
auto-answered; this is why the whole set is `verified`).

**Ungodly Mess (167 cards) — done** (159 `verified` + 6 `vanilla` + 2
`wontImplement`). Added 10 capabilities in one pass —
`distinctCount` expression, `CardSelector.attachedToFaction`,
`CardDefinition.thresholdSlack` (FEALTY), granted **continuous** abilities
in `ContinuousAbility.grantedAbilities` (God's Blessing cycle),
`blockRestriction.blockerMustNotMatch`, `ContinuousAbility.voidPlay` /
`playRestrictions` / `restrictReturnToHand`, `preventAllDamage` /
`restrictDestruction` effects. Also made `stat`/`counter`/`cardCost`/
`printedStat` read as 0 on an unresolved target (was a hard assert). See
`BEHAVIORS.md` → "Ungodly Mess additions" and RULES.md §12. `wontImplement`:
Trickster's Globe (faction-damage→mill replacement class + deck-out loss),
Lost on Floor 3 (cancellable end-of-turn declaration). Test coverage:
`ungodly-mess-caps.test.ts` (one fixture per new capability),
`ungodly-mess-smoke.test.ts` (10 hand-written end-to-end scenarios through
the real catalog), `ungodly-mess-exercise.test.ts` (**every** authored card
instantiated from the catalog and played / activated / triggered on a broad
synthetic board with every pending choice auto-answered — this is why the
whole set is `verified`).

**1st Edition Part 2 (165 cards) — done** (160 `verified` + 5 `vanilla`).
Added 21 capabilities in one pass — `battlePartySize` / `extremumStat`
expressions, `isCard` / `damagedThisTurn` / `destroyedByBattleDamage`
conditions, `attachmentHost` / `respondedAbilitySource` TargetRefs,
`CardSelector.nameVar`, `terminate.disposition`, `takeControl.duration`,
`deployForFree.free`, `lockAbilityThisTurn` / `flipCoin` (+ `coinFlipped`
event + a `replaces:{event:"coinFlip",result:"lose"}` replacement) /
`restrictBlockers` / `restrictBlockersToChosen` / `grantAbilitiesFrom` /
`initiateAttack` / `auctionForCard` effects, `DamageModifierDefinition`
`minAmount`/`setTo`, `ContinuousAbility` `partyRestriction` /
`blockRestriction` / `abilityCostModifiers`, `cardDestroyed.byBattleDamage`.
See `BEHAVIORS.md` → "1st Edition Part 2 additions" and RULES.md §8 / §12.
Test coverage: `first-ed-part2-caps.test.ts` (one fixture per capability),
`first-ed-part2-smoke.test.ts` (12 hand-written end-to-end scenarios through
the real catalog), `first-ed-part2-exercise.test.ts` (**every** authored
card instantiated from the catalog and played / activated / triggered on a
broad synthetic board with every pending choice auto-answered — no crash /
bad selector / missing handler / choice loop; this is why the whole set is
`verified`).

**Holy Heist (132 cards)** added ~37 capabilities in one pass —
`healDamage`, `suppressAbilities` / `suppressKeyword` effects,
`grantKeywordToPlayer` ("characters you control and deploy gain AGGRO"),
`transformBattleDamage` (Don't Trip / Ocular Dispersal / Vexing Nullifier),
`randomFromSelection`, `separateIntoPiles` + `pileAssignment` choice,
`grantVoidPlay` (deploy from the void — Cheats), `lookAndReorder to:"split"`
(partial-bottom scry), `moveSelected` + `shuffleDeck` costs,
`Duration.untilStartOfNextTurn`, `scheduleEffect:startOfOpponentNextTurn`
(now runs through the suspendable effect-frame path, so chooser pauses in a
scheduled rider work), `cardsDiscarded` + `blockingPartyFormed` events,
`mustBePicked` / `cannotUseAbilities` restrictions, `canBlockAnyParty`
keyword, `ReplacementAbility.chooser` (affected player pays — Unloyal
Necromorph), `usableBy:"opponent"`, `TargetDeclaration.distinctNames`,
`nameValue:"trade"` + `CardSelector.tradeVar`, `behavior.keepOnHostLeave`,
a tactic with `attachTo` resolving into play attached, `hasKeyword` /
`isToken` / `eventCardIs` / `targetInZone` / `battleTargetIs` /
`battleDamageAssigned` / `textMentionsIcon` / `cardNameIs` conditions,
`hasAttachment.ofSubtype`, `sumCounters` / `respondedToPicked` refs,
`preventDamage.wholeInstance`, `voidPlayGrants` state. See `BEHAVIORS.md` →
"Holy Heist additions" and `COVERAGE.md`'s capability table.

**Shade of the Devoured Emperor (the Volition / Thabbash era)** added ~46
capabilities in one pass — `grantProvides` (card-level PROVIDES this turn),
`loseInfluence` cost, `reduceThreshold`, `nameValue:resourceIcon`,
`removeCardType`, `cannotBePicked` / `attackOncePerTurn` /
`cannotBeTakenControl` / `cannotBeRestoredByRule` restrictions,
`suppressAllAbilities` ("loses all other rules text"), `redirects` (ward
redirect), `scheduleEffect:endOfBattle`, `addToBattle`, `restrictPlay`,
`counterChanged` + `attackerBlocked` events, `skipRestoreRule` /
`skipNextRestore`, `modifyNumericCost` / `modifyOutgoingDamage`,
`chooserSelectsNumber` / `alternatingPayLoop` / `anyPlayerMayPay`,
`createTokens.effects`, `putIntoPlay.borrowed`, `deployFromZone.free`,
granted **activated** abilities, `behavior.modes` (modal tactics),
`behavior.onPlay.costAdjust`, `behavior.noResponse`, `revealFromHand` rider,
`activeZone: "hand"` continuous, `damageModifiers.sourceSelector`,
`hasAttachment` — plus a **CR §408.3 fix**: non-battle damage to a faction
card now converts to influence loss (was inert). See `BEHAVIORS.md` → "Shade
of the Devoured Emperor additions" and `RULES.md` §12.

**Seed 3's 8 non-tournament "EPIC"/"Showdown" faction cards** have their
setup blocks + in-scope activated abilities authored from the card art
(`FactionDefinition.{abilities, meetsAllThresholds}`, `turn.{startOfTurnEffects,
develop.usesPerTurn}`, `ActivatedAbility.usableBy` — RULES.md §3.6). 4 are
`high`, 4 `medium`.

**The five "medium" parity gaps are now closed** (6 new capabilities —
`opponent-may-pay-to-counter`, `develop-draw-replacement`,
`deck-search-trigger`, `card-ignores-source-class`,
`cross-faction-rule-override`, `mixed-starting-resources`; see the "parity:"
`describe`s in `card-behaviors.test.ts` and RULES.md §3.1 / §3.6 / §3.8 / §6
/ §7 / §12). Two `parityGaps` remain, both 2-player-engine-out-of-scope:
`double-sided-faction` (EPIC card-flipping) and `showdown-multiplayer`.

**`parityGaps`**: a top-level `data/card-coverage.json` registry of printed
clauses deliberately left unmodelled because closing them needs a large
engine / game-format refactor. Distinct from `capabilities` (small buildable
additions) and `wontImplement` (whole card unmodellable) — a card with a
parity gap is still `verified` for its in-scope parts and links the gap id.
`card-data-integrity.test.ts` keeps the registry honest.

**The 66 `classified` cards** (1st Edition 40, 2nd Edition 26) are
pre-existing `behavior` blocks, audited against printed text + the CR —
vocabulary-valid and faithful. Promoting them to `authored`/`verified` just
needs each driven through a real-JSON smoke path (a per-set `*-exercise.test.ts`
does this — see how Open Beta's 40 prior-pass cards were promoted).

`data/cards.json` is normalized to `JSON.stringify(_, null, 2)` (LF) so it
matches `src/data/cards.js` and edits produce clean diffs.

### Reusable machinery

| File | Role |
|---|---|
| `data/card-coverage.json` | per-card checklist + `capabilities` backlog (source of truth) |
| `scripts/build-coverage.cjs` | rebuilds the manifest skeleton + `COVERAGE.md`; `--check` for CI; `--accept-text <id>` after re-reviewing a text change |
| `COVERAGE.md` | generated status roll-up (never hand-edit) |
| `.github/workflows/ci.yml` | on push / PR: `sync-cards` + `git diff --exit-code src/data/cards.js` → `build-coverage.cjs --check` → `npm run typecheck` → `npm test` |
| `src/engine/__tests__/card-data-integrity.test.ts` | enforces manifest↔catalog agreement, vocabulary parse, the one-pass invariant, metadata mirroring |
| `src/engine/__tests__/card-behaviors.test.ts` | one test per ability *shape* (see "Testing convention" in BEHAVIORS.md) |
| `src/engine/__tests__/{seed2,seed3}-smoke.test.ts` | per-set smoke: authored JSON driven through the public API |
| `BEHAVIORS.md` | the authoring vocabulary index + "Coverage workflow" |
| `RULES.md` · `docs/*.pdf` | the rules the engine is tested against — `docs/` (Comprehensive Rules + FAQ PDFs) is the source; `RULES.md` the distilled reference |

### The per-set loop (the "one pass")

1. **Classify** every card in the set: fill its `data/card-coverage.json`
   entry — `behavior.shapes` from the existing vocabulary, `metadata`
   (`unique`/`attachTo`/`resource.provides`/`keywords`), and
   `engineCapability` (with a spec appended to `capabilities`) only where
   today's vocab genuinely can't express it. Cite `RULES.md` / `docs/`;
   record ambiguities as `notes` + low `confidence` rather than guessing.
   Status → `classified` (or `blocked` for an unbuilt capability, or
   `vanilla` / `wontImplement`).
2. **Consolidate** the flagged capabilities: dedupe, then for each — design
   the discriminated-union member in `src/types/` first, write a fixture
   test in `card-behaviors.test.ts`, implement in `SpoilsEngine.ts`, update
   `RULES.md` + `BEHAVIORS.md` in the same change, flip the capability to
   `status: "implemented"`.
3. **Author** the `behavior` JSON onto the cards (a throwaway
   `scripts/_author-<set>.cjs` that patches by id and writes
   `JSON.stringify(_, null, 2)`), `npm run sync-cards`, status → `authored`.
4. **Verify**: `npm test`, `npm run typecheck`, extend the per-set smoke
   test with ~5–8 representative cards, status → `verified`.

Authoring a set does not begin until classification is complete and every
referenced capability is implemented — the invariant
`card-data-integrity.test.ts` enforces.

Expectation per set: ~85–90% straight authoring, ~8–12% small vocab
additions, ~2–5% `wontImplement`. Finish a set's whole classification
before authoring any of it.

---

## What's left

Every set is classified (`unclassified: 0`). The remaining work is the
**207 `authored` cards** — Seed 2 (97) + Shade of the Devoured Emperor (110).
Their behaviour JSON is written and shape-proven by the per-capability
fixtures + `card-data-integrity.test.ts`; they are not yet `verified` only
because nothing drives them through the public API. The mechanical promotion:

1. `cp src/engine/__tests__/seed-saga-exercise.test.ts src/engine/__tests__/seed2-exercise.test.ts`
   (and one for SotDE), swap the `set === "Seed Saga"` filter + the
   `SSSET` const name.
2. Run it; the harness surfaces any crash / bad selector / missing handler /
   choice loop. Fix those in `data/cards.json` (or the engine, if a genuine
   gap — none expected).
3. A `.work/promote-<set>.cjs` flips those coverage entries `authored →
   verified` once the exercise is green; add a `<set>-smoke.test.ts` with
   ~8 representative hand-written scenarios (there is already a
   `seed2-smoke.test.ts` / `sotde-smoke.test.ts` covering ~13–15 each — just
   extend them).
4. `npm test`, `npm run typecheck`, `node scripts/build-coverage.cjs`,
   update this file. Register the new test files in
   `card-data-integrity.test.ts` `behaviorsTestSrc`.

Both 2nd Edition and Seed Saga are done — see the per-set write-ups above.
2nd Edition was a **pure reprint** of 1st Edition + 1st Edition Part 2 (zero
new capabilities); Seed Saga was ~89% reprint + 40 genuinely-novel cards, all
authored from the existing 219-capability vocabulary (zero new capabilities).

**Holy Heist — done** (165/165): 33 vanilla, **132 `verified`**. Test
coverage:
- `holy-heist-caps{,2,3}.test.ts` — one semantic fixture per new capability
  primitive (37 capabilities).
- `holy-heist-smoke.test.ts` (13 cards) + `holy-heist-newshapes.test.ts`
  (Change of Tactics / Cheats / Confessions) + the Profane Proposal case in
  `card-behaviors.test.ts` — hand-written end-to-end scenarios through the
  real catalog + public API.
- `holy-heist-exercise.test.ts` — **every** authored card: instantiated
  from the real catalog on a broad synthetic board, then played / every
  activated ability activated / triggers fired, with every pending-choice
  kind auto-answered by a safe default. Asserts no crash / bad selector /
  missing handler / choice loop. This is why the whole set is `verified`.

Concessions (documented in each card's coverage `notes`): Cathédrale de Mau
models "reduce damage by 1" as a post-damage `healDamage` (can't rescue
from a lethal hit); Phantasmagoric Tollbooth's enters-play gate is a
`cardEnteredPlay` trigger + `mayPay` (the ETB fires before the possible
discard — the engine has no enters-play replacement); Spurious
Anthropologist uses `putIntoPlay.borrowed` for its "remove both" rider. The
"[V] enters play under your control" cycle is authored as TWO triggers
(`resourcePlayed` + `cardEnteredPlay`) per the Seed 2 idiom —
`playResourceCard` does not emit `cardEnteredPlay`.

**One engine gap surfaced (for later sets, not HH-blocking):** a
`ReplacementAbility` with `replaces.event: "moveToZone", zone: "play"` never
fires — `moveToZone` replacements only trigger on *leaving* play. Open Beta
/ 2nd Edition likely need a real enters-play replacement (hook
`applyReplacement` into `finishStackItem` + `putCardIntoPlay`, with a
recursion guard).

**Shade of the Devoured Emperor — done** (130/130): 5 vanilla, 110
`authored`, 15 `verified` (`sotde-smoke.test.ts` + per-capability fixtures in
`card-behaviors.test.ts`). The other ~110 `authored` cards have their shape
proven by the capability fixtures + `card-data-integrity`; promoting them to
`verified` just needs each driven through the real-JSON smoke path.

### spoils-game (`~/dev/spoils-game`) needs wiring for these engine surfaces

`spoils-db` is a `file:` dep — `npm run build` here refreshes it. Do this
before shipping a deck with Seed 2 cards to the renderer; an unhandled
pending choice / event / action stalls the UI.

- `PendingChoice` kind **`useAnyAbility`** — panel case (pick a
  `candidateCardIds` card, then route the chosen ability's targets through
  `ActionFlow`) + `describePendingChoice`.
- `PendingChoice` kinds **`partitionCards` / `pickPile` / `takeFromPile`**
  (the MUSTACHE SHOWDOWN sequence) — panel case + `describePendingChoice`
  for each.
- `chooseDevelop` **`revealFromHand`** payload — a "reveal & deploy for N"
  affordance in the develop-rule UI for a hand card with
  `CardDefinition.revealFromHand`.
- Event **`cardsDrawn`** — add to the log / status enumeration
  (informational).
- **Holy Heist:** `PendingChoice` kind **`pileAssignment`** (Profane
  Proposal — partition the revealed cards into two piles) — panel case +
  `describePendingChoice`. `reorderDeck` choice gains a **`bottom`** array
  when its `to` is `"split"` (Ignatius Gloamspike / Confessions — a
  top/bottom scry split). Events **`cardsDiscarded`** /
  **`blockingPartyFormed`** — add to the log enumeration (informational).
- **1st Edition Part 2:** three new `PendingChoice` kinds — **`auctionBid`**
  (Auction House — `{ bid: 0 }` = pass; cap at `maxBid`), **`coinFlipReplace`**
  (Two-Headed Coin — `{ reflip: boolean }`), **`chooseChosenBlockers`**
  (Wyrmfang Deathskull — `{ cardIds }` ⊆ `candidates`). Each needs a
  `decidePendingChoice` decline/safe branch (`policyBot.ts` — non-nullable
  return, so this is a compile error until handled), a `describePendingChoice`
  case (`statusText.ts`), and a `PendingChoicePanel.tsx` panel case (soft-lock
  otherwise). Event **`coinFlipped`** — log enumeration (informational). No
  new `Cost` / `GameAction` shapes (`describeCost` unaffected).
- **Open Beta / 1st Edition — DONE in spoils-game** (2026-09-01): one new
  `PendingChoice` kind **`spendCountersMenu`** (Voidal Poisoning) —
  `policyBot.ts` `decidePendingChoice` (safe branch `{ optionIndex: null }`),
  `statusText.ts` `describePendingChoice`, `PendingChoicePanel.tsx`
  (`SpendCountersMenuChoice` — options as buttons with token cost + greedy
  `sources` auto-pick + Stop). Plus `ActionDock.tsx` `collectAbilityRows`
  now surfaces borrowed opponent abilities (The Billionaire). New event
  `cardPicked` — the consumer has no event-log enumeration, nothing to
  wire. All other capabilities (new effects / conditions / expressions /
  `ContinuousAbility` fields) are engine-internal — no consumer surface, no
  new `Cost` shapes. `npm run typecheck` + `npm test` green in both
  workspaces.

---

## Quick reference

```
npm test                                  # node:test via tsx, all *.test.ts under src/
npm run typecheck                          # tsc --noEmit (app + test configs)
npm run sync-cards                         # data/cards.json -> src/data/cards.js
node scripts/build-coverage.cjs            # refresh manifest + COVERAGE.md
node scripts/build-coverage.cjs --check    # CI: fail if stale
node --import tsx --test src/engine/__tests__/<file>.test.ts   # single file
```

Vocabulary lives in `src/types/{costs,conditions,effects,expressions,cards}.ts`;
the engine `switch`es are in `src/engine/SpoilsEngine.ts`
(`resolveEffect`, `evaluateCondition`, `evaluateNumber`, `payCost`,
`resolvePendingChoice`, `applyReplacement`, `checkStateBasedActions`).
