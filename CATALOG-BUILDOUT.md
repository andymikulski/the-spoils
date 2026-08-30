# CATALOG-BUILDOUT.md

Hand-maintained plan for implementing the **full ~2100-card catalog** in the
data-driven engine. This is the pick-up point for a future session.

> Status is tracked machine-readably in `data/card-coverage.json` (source of
> truth) and the generated `COVERAGE.md`. The process is documented in
> `BEHAVIORS.md` → "Coverage workflow". This file is the *roadmap*: what's
> done, what the open gaps are, and the concrete TODOs to close them.

---

## Current state (Seed 2 + Seed 3 complete; TODO 1–5 done)

| | count |
|---|--:|
| Catalog total | 2101 |
| `verified` | 50 (Seed 3: 38 · Seed 2: 12 smoke-tested) |
| `authored` (JSON written, driven by fixture tests) | 98 (rest of Seed 2) |
| `classified` (audited, awaiting a smoke path) | 107 (TODO 1 — prior-pass behavior blocks) |
| `blocked` | 0 |
| `vanilla` (no behavior needed) | 156 |
| `unclassified` (remaining work) | 1690 |
| `rulesAudited` | 260 / 2101 (107 prior-behavior + 43 Seed 3 + 110 Seed 2) |
| Engine capabilities implemented | 64 / 64 (nothing unimplemented) |
| Seed 2 confidence | 109 `high` · 1 `medium` (Rosy Palmer) · 0 `low` |
| Test suite (spoils-db) | 342 passing (`npm test`), `npm run typecheck` clean |
| Test suite (spoils-game) | core 35 + web 19 passing (TODO 7 wires 3 new engine surfaces) |

**Seed 2 pass (2026-08-30):** all 110 cards classified against printed text
+ `RULES.md`, then authored — **98 `authored`, 12 `verified`, 0 `blocked`**.
~32 new engine capabilities, all implemented in this pass — no deferral, no
cut cards. The set is the "FLIP UP era": heavy face-down manipulation.

- New effects: `flipFaceDown`, `putIntoPlay`, `deployFromZone`,
  `grantResourceIcons`, `detach`, `scheduleEffect`, `useAnyAbility`,
  `rememberTarget`, `duplicate`, `setCardType`, `retargetExtraCost`,
  `partitionAndPick`; `mill.to`, `terminate` `respondedItem` scope.
- New conditions: `cardProvides`, `isStaple`, `cardDepleted`,
  `cardTypeEquals`, `sharesBattlePartyWithSource`, `linkedCardInPlay`,
  `sourceIsFaceDown`, `isExtremum`, `respondedToPicked`;
  `respondingTo.respondsTo:"ability"`.
- New card/ability shape fields: `CardDefinition.{selfDisposition,
  revealFromHand}`, `TriggeredAbility.triggerZone`,
  `ActivatedAbility.{variableBounds,usesPerTurn,fromFaceDown}`,
  `ContinuousAbility.{suppressKeywords,grantedAbilities,grantFlipUp}`,
  `CardSelector.{faceDown,staple,name}`, `deployFromZone.ignoreThreshold`,
  `{type:"remembered"}` TargetRef, `{type:"oneOf"}` Cost, `cardsDrawn`
  event, `canBlockCovert` keyword, `cannotBeRestored` restriction.
- New state: `GameState.{cardTypeGrants,pendingPartition}`; new
  `PendingChoice` kinds `partitionCards` / `pickPile` / `takeFromPile`; a
  `revealFromHand` payload on the `chooseDevelop` action.
- `src/engine/__tests__/seed2-smoke.test.ts` — 12 scenarios (Alluring
  Quicksand, Surplus Soldier, Acidic Phlegm, Gilded Yurt, Golemizer,
  Manifest, Crest of Rage, Dying Hero, Contrabulous Fabtraption, Mistaken
  Identity, Mustache Aficionado, Witty Worm).

**The former 4 `blocked` cards — now built (2026-08-30).** Total parity was
chosen over cutting them (the primitives will recur — Seed Saga already
reprints all four):
- *Contrabulous Fabtraption* — `setCardType` effect + `getCardTypes` /
  `hasCardType` + `GameState.cardTypeGrants` (RUNE OF ANIMATION: the item
  *gains* the character type — CR §208.1, keeps its item type — with
  str/life = cost, 3 speed, EOT; RULES.md §3.7). Also needed
  `CardSelector.name` for RUNE OF ACCELERATION ("a card named Elitism").
  All 6 runes authored.
- *Mistaken Identity* — `retargetExtraCost` effect + `respondedToPicked`
  condition: rewrites a responded-to stack item's stored extra-cost card
  pick (RULES.md §7).
- *Mustache Aficionado* — `partitionAndPick` effect + a `partitionCards` →
  `pickPile` → `takeFromPile` pending-choice state machine on
  `GameState.pendingPartition` (RULES.md §12).
- *Witty Worm* — `CardDefinition.revealFromHand` + a `revealFromHand`
  payload on `chooseDevelop` + a `costOverride` on `deployCard`: reveal
  from hand instead of the develop resource play, deploy for a flat cost
  (RULES.md §6).

**Seed 2 bookkeeping pass (2026-08-30).** Re-audited all 110 authored
cards' coverage `notes` / `confidence` against the *implemented* behavior
(the classification-time notes were written before the capabilities
existed). 27 stale entries refreshed → **109 `high`, 1 `medium`, 0 `low`**.
One real authoring gap found and fixed: I Drink Your Milkshake!'s "deploy
it even if you cannot meet its threshold" now uses the new
`deployFromZone.ignoreThreshold` flag.

**The one remaining Seed 2 approximation** — *Rosy Palmer, and Her Five
Friends* (`medium`): "reveal the top 5 of an opponent's deck, you may take
a revealed character, that player bottoms the rest in any order" is modelled
as "pick a character from anywhere in the opponent's deck → put into play;
shuffle their deck." Faithful in outcome shape, not in the reveal-window /
bottom-order detail. Needs a "reveal top N as a candidate pool" primitive +
a bottom-of-deck reorder — see backlog. Not blocking; the card functions.

`"each opponent"` / `"that character's controller"` on other cards resolve
to the single opponent — exact, since the engine is 2-player only.

**Seed 3 final review (2026-08-27):** all 38 authored cards re-read against
printed text + `RULES.md`. Fixes:
- *Spatchcocking* RECUR wrongly used `forEachPlayer` for its "Each opponent
  ..." clause → in 2-player the caster discarded their own hand too. Now
  opponent-scoped.
- *Hilarious Refrigerator Alarm* — FLIP UP rider "... and you may play a
  resource" was missing from `flipUp.effects`. Added.
- *Notion Sickness* target now gated by a new `hasAbility` condition ("a
  card ... with an ability in its rules text").
- *Prestige Inversion* / *Spatchcocking* RECUR icon thresholds ("[G][G]",
  "[O][O][O][O]") were unenforced — added `ActivatedAbility.threshold`.
- 3 new `seed3-smoke.test.ts` cases (Spatchcocking RECUR scoping, the Alarm
  rider, Geiseric's optional replacement — previously untested).

**Seed 3 is the proof of concept** — it was the hardest set (a parody set),
and it forced all 30 capabilities. Real expansions should reuse most of
that vocabulary. `data/cards.json` has been normalized to
`JSON.stringify(_, null, 2)` (LF) so it matches `src/data/cards.js` and
future edits produce clean diffs.

### Reusable machinery (already built)

| File | Role |
|---|---|
| `data/card-coverage.json` | per-card checklist + `capabilities` backlog (source of truth) |
| `scripts/build-coverage.cjs` | rebuilds the manifest skeleton + `COVERAGE.md`; `--check` for CI; `--accept-text <id>` after re-reviewing a text change |
| `COVERAGE.md` | generated status roll-up (never hand-edit) |
| `src/engine/__tests__/card-data-integrity.test.ts` | enforces manifest↔catalog agreement, vocabulary parse, the one-pass invariant, metadata mirroring |
| `src/engine/__tests__/card-behaviors.test.ts` | one test per ability *shape* (see "Testing convention" in BEHAVIORS.md) |
| `src/engine/__tests__/seed3-smoke.test.ts` · `seed2-smoke.test.ts` | per-set smoke: authored JSON driven through the public API |
| `BEHAVIORS.md` | the authoring vocabulary index + "Coverage workflow" |
| `RULES.md` | authoritative rules the engine is tested against |

### The per-set loop (the "one pass")

1. **Classify** every card in the set: fill its `data/card-coverage.json`
   entry — `behavior.shapes` from the *existing* vocabulary, `metadata`
   (`unique`/`attachTo`/`resource.provides`/`keywords`), and
   `engineCapability` (with a spec appended to `capabilities`) only where
   today's vocab genuinely can't express it. Cite `RULES.md`; record
   ambiguities as `notes` + `confidence: "low"` instead of guessing.
   Status → `classified` (or `blocked` if it needs an unimplemented
   capability, or `vanilla` / `wontImplement`).
2. **Consolidate** the flagged capabilities: dedupe, then for each —
   design the discriminated-union member in `src/types/` *first*, write a
   fixture test in `card-behaviors.test.ts`, implement in `SpoilsEngine.ts`,
   update `RULES.md` + `BEHAVIORS.md` in the same change, flip the
   capability to `status: "implemented"`.
3. **Author** the `behavior` JSON onto the cards in `data/cards.json`
   (a throwaway `scripts/_author-<set>.cjs` that patches by id and writes
   `JSON.stringify(_, null, 2)` is the clean way), `npm run sync-cards`,
   status → `authored`.
4. **Verify**: `npm test`, `npm run typecheck`, extend the smoke test with
   ~5 representative cards from the set, status → `verified`.

Authoring a set does **not** begin until classification is complete and
every referenced capability is implemented — that is the invariant
`card-data-integrity.test.ts` enforces.

---

## TODO

### 1. Audit the 107 unaudited prior-AI `behavior` blocks — DONE

All 107 (Open Beta 40, 1st Edition 40, 2nd Edition 26, Ungodly Mess 1) read
against printed text + `RULES.md`. The earlier pass was solid — every block
is a vocabulary-valid, faithful encoding; **no rewrites** were needed. Only
~11 distinct cards under those 107 (each reprinted 2–3×): most reuse an
ability shape that already has a `card-behaviors.test.ts` case, the rest
are trivial (bounce / +N stat / inflict N / draw).

- [x] All 107 → `status: "classified"`, `rulesAudited: true`, `shapes` /
      `metadata` / `confidence: high` / `notes` filled (throwaway
      `scripts/_audit-107.cjs`, since deleted).
- [x] **Data bug fixed:** 5 ATTACH-TO cards (Open Beta Kettinger,
      Lugubrious Finger Trap, Napiform Protuberance, Very Big Hat of
      Invisibility; 2nd Edition Lugubrious Finger Trap) had "ATTACH TO
      CHARACTER" text but no `attachTo` field — their behavior's
      `attachedTo` modifiers would have been inert. Added `attachTo:
      "character"` (matching their 1st-Edition counterparts).
- **Left for later:** promoting these to `authored`/`verified` needs each
  driven through a real-JSON smoke path (they already have the JSON).

### 2. Catch spoils-game up to the engine (`~/dev/spoils-game`) — DONE

The engine's 4 unhandled `PendingChoice` kinds + `flipUp` action would
**stall the UI** on a Seed 3 card. All wired (spoils-game typecheck +
`npm test` green: core 35, web 19):

- [x] `packages/web/src/components/PendingChoicePanel.tsx` — `case`s for
      `replacementChoice` / `mayPay` (a shared `AcceptDecline`, cost shown
      via the new `describeCosts`), `nameValue` (text input + `<datalist>`
      of catalog subtypes / names), `useTargetAbility` (ability buttons +
      Decline; routes through `ActionFlow` when the chosen ability needs
      input, like `DeployForFreeChoice`).
- [x] `packages/web/src/statusText.ts` — `describePendingChoice` handles all
      12 kinds (this is what broke web's typecheck once spoils-db rebuilt).
- [x] **Flip-up affordance:** `getFlipUpAffordability` in
      `packages/core/affordability.ts` (threshold via `parseThreshold` +
      `getThresholds`; cost vs `getAvailableResourceCount` minus the
      face-down card itself). `PlayerBoard` gains `resourceSelectable` /
      `onResourceClick`; `App` gains `resourceInteractionFor` +
      `startFlipUp` + `<FlipUpFlow>` (mirrors `startPlayCard` /
      `PlayCardFlow`, dispatches `{ type: "flipUp", ... }`).
- [x] `spoils-db` is a `file:` dep — `npm run build` here refreshes what
      spoils-game consumes; no version bump.
- [x] Also fixed `walkNumberExpression` (missing `conditional` /
      `printedStat` / `resourceIcons` cases) and added `describeCost` /
      `describeCosts` + tests.
- **Done when:** ✅ the Seed 3 sampler (`?deck=seed3-sampler` or the
  game-over deck `<select>`) can be played start-to-finish — no pending
  choice or flip-up card can stall the renderer now.

### 3. Extend the coverage schema — DONE

- [x] Status **`wontImplement`** added — `build-coverage.cjs` `STATUSES` +
      `RESOLVED_STATUSES`, `card-data-integrity.test.ts` `STATUSES` (+ a
      test that each such entry carries a `notes`), `BEHAVIORS.md`.
      `COVERAGE.md` has a `wontImpl` column, a "Won't implement" list, and
      counts them toward "% done".
- [x] Boolean **`rulesAudited`** added to every entry (backfilled `false`).
      `COVERAGE.md` shows an `N/2101` rules-audited line.

### 4. Add a Seed 3 sampler deck for UI/feature testing — DONE (spoils-db side)

- [x] `src/data/decks/seed3-sampler-ids.js` (the imported list) +
      `seed3-sampler.json` (full-object mirror). 40 cards: The Evil
      Alliance + one copy of all 18 Seed 3 new-mechanic cards + 21
      1st-Edition basic resources across every icon. Wired into
      `src/data.ts` as `SEED3_SAMPLER_DECK`, `src/index.ts` as
      `seed3SamplerGame()`, and covered by a `seed3-smoke.test.ts` case
      (builds a real faction game, reaches turn 1, 2 staples in play).
- [x] Added to spoils-game: `web/src/game.ts` `createNewGame("seed3-sampler")`,
      selectable via `?deck=seed3-sampler` or the game-over deck `<select>`.
- **Purpose:** exercises every new engine path through the real renderer;
  gates TODO 2.

### 5. CI / pre-commit guard — DONE

- [x] `.github/workflows/ci.yml` runs on push-to-main and every PR:
      `yarn install --frozen-lockfile` → `npm run sync-cards` +
      `git diff --exit-code src/data/cards.js` (catches a `cards.json` edit
      with no re-sync) → `node scripts/build-coverage.cjs --check` (stale
      manifest / COVERAGE.md) → `npm run typecheck` → `npm test` (textHash
      drift, vocabulary typos, engine rules).

### 6. Work the remaining 10 sets (smallest → largest) — NOT STARTED

The big one — ~1800 `unclassified` cards. Run the per-set loop above.
Order by remaining `unclassified` (post-TODO-1: the 107 prior-behavior
cards in Open Beta / 1st Edition / 2nd Edition are now `classified`, so
their per-set `unclassified` counts dropped):

| Set | `unclassified` | notes |
|---|--:|---|
| ~~Seed 2~~ | ~~110~~ | **DONE (2026-08-30)** — 98 authored, 8 verified, 4 blocked; +27 capabilities |
| Shade of the Devoured Emperor | 125 | |
| Holy Heist | 132 | 33 already vanilla |
| Ungodly Mess | 161 | Zenobia's Tower structure fixed; 1 already classified |
| 1st Edition Part 2 | 161 | |
| Open Beta | 144 | 40 prior-behavior cards now `classified` (TODO 1) |
| 1st Edition | 162 | 40 prior-behavior cards now `classified`; the two precon decks draw from here (verified) |
| Seed | 209 | |
| 2nd Edition | 256 | 26 prior-behavior cards now `classified` |
| Seed Saga | 340 | largest; long tail of one-offs likely |

Expectation for each set: ~85–90% straight authoring, ~8–12% small vocab
additions (surfaced as `blocked` + spec), ~2–5% `wontImplement`. A set's
manifest must not be left half-classified — finish the whole set's
classification (`classified`/`vanilla`/`blocked`/`wontImplement` for every
entry) before moving on, per the one-pass invariant.

### 7. Catch spoils-game up to the Seed 2 engine surface — NOT STARTED

The Seed 2 pass added renderer-facing surfaces that spoils-game does not
handle yet (same failure mode TODO 2 fixed for Seed 3 — an unhandled
pending choice / event / action stalls the UI):

- [ ] `PendingChoice` kind **`useAnyAbility`** (`{ kind, id, playerId,
      candidateCardIds, context }`) — needs a `case` in
      `PendingChoicePanel.tsx` (pick one of `candidateCardIds`, then route
      through `ActionFlow` for the chosen ability's own targets, like
      `useTargetAbility` / `deployForFree`) and in
      `statusText.ts` `describePendingChoice`. Resolved with
      `{ kind: "useAnyAbility", cardId }`.
- [ ] `PendingChoice` kinds **`partitionCards`** (`{ cardIds, piles }` →
      `{ piles: CardInstanceId[][] }`), **`pickPile`** (`{ piles }` →
      `{ index }`), **`takeFromPile`** (`{ candidates, max }` →
      `{ cardIds }`) — the MUSTACHE SHOWDOWN sequence (Mustache
      Aficionado). Each needs a panel case + `describePendingChoice`.
- [ ] `chooseDevelop` **`revealFromHand`** payload (`{ type: "playResource",
      cards: [], revealFromHand: { cardId } }`) — the develop-rule UI needs
      an "instead: reveal & deploy for N" affordance for a hand card with
      `CardDefinition.revealFromHand` (Witty Worm). Cost/threshold via the
      existing `getFlipUpAffordability`-style helper.
- [ ] Event **`cardsDrawn`** (`{ playerId, count }`) — if the log / status
      layer enumerates `GameEventType`, add it (informational; no
      interaction).
- `spoils-db` is a `file:` dep — `npm run build` here refreshes it. No
  version bump. Do this before shipping a deck that includes Seed 2 cards
  to the renderer.

---

## Known engine debt

**Cleared** (2026-08-27). The former list is resolved:

- **FLIP UP** now resolves its effects (rider + own) through the same
  suspendable effect-frame path as everything else — a chooser among them
  pauses cleanly, and the wrap-up waits (`flipUpCard` / `finishFlipUp`).
  (Also fixed a latent bug: a face-down card could pay its own FLIP UP
  numeric cost.)
- **Optional replacement** is fully wired (mandatory + optional, both
  events). `replaces.by` (`self`/`opponent`/`any`) scopes on *who
  initiated* the event ("by an opposing card or effect"), incl. lethal
  battle damage — **Giada** re-authored, tests added. Damage-would-be-
  inflicted is *deliberately* not a replaceable event (no card needs it;
  `ContinuousAbility.damageModifiers` covers amount tuning) — see backlog.
- **`forEachPlayer`** pause/reorder now has a dedicated two-player
  double-pause test.
- **Anatidaephobia** "pay X" is a real hard play-time cost — one
  `payResources` whose amount is `conditional(deployedViaFlipUp ? 0 :
  cardCost(respondedToCard))`. Unaffordable ⇒ the card can't be played.
- **Damage modifiers per assignment** is a deliberate ruling (each source's
  contribution is a distinct instance — standard CCG reading), firmed up in
  RULES.md §8 and locked by a multi-source test. Not debt.
- **Community Chest** mulligan history: `GameState.mulligan` +
  `bottomedInMulligan` condition added — see backlog for the remainder.
- **Location `structure`**: all 140 present (Zenobia's Tower read from the
  card art — the source dump mislabelled its STRUCTURE shield as `speed`);
  `card-data-integrity.test.ts` enforces it.

### Backlog — deliberate boundaries, not debt (no card needs them yet)

- **Damage as a replaceable event** — `ReplacementAbility.replaces` has no
  `{ event: "damage" }`. Nothing in the catalog needs "if damage would be
  inflicted, instead ..." today; `damageModifiers` handle "increase/reduce
  by N". Add the event + a mid-battle-damage pause path only when a card
  forces it.
- **Community Chest, the rest of the mulligan clause** — needs (a) an
  optional "you may reveal it" prompt during the opening mulligan, and
  (b) a triggered ability that fires while its source sits in the *deck*
  zone (`findTriggers` is play-only — the parallel of `activationZone` for
  triggered abilities). Ambiguous parody-card wording; deferred.
- **"Reveal the top N of a deck as a candidate pool" + bottom-of-deck
  reorder** — *Rosy Palmer* wants "reveal the top 5 of an opponent's deck,
  you may take a revealed character, the owner bottoms the rest in any
  order." Today a `zone: "deck"` selector reaches the *whole* deck and the
  only deck reorders are top-N (`lookAndReorder`). Model would be a target
  declaration scoped to a snapshot of the top N + a `lookAndReorder`
  variant that writes to the bottom. Only Rosy Palmer so far; she's
  authored with the outcome approximated (`medium` confidence).
- ~~**The 4 `blocked` Seed 2 cards**~~ — **built 2026-08-30**
  (`type-change-modifier`, `retarget-extra-cost`, `partition-and-pick`,
  `reveal-from-hand-alt-cost` + `name-selector`, all `implemented`). See
  "The former 4 `blocked` cards" under Current state. Total parity chosen
  over cutting: the primitives recur in later sets (Seed Saga reprints all
  four).

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
