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
| `verified` (smoke-tested through the public API) | 66 |
| `authored` (behavior JSON written, fixture-tested by shape) | 207 |
| `classified` (audited, not yet authored) | 107 |
| `vanilla` (no behavior needed) | 156 |
| `unclassified` | 1565 |
| `rulesAudited` | 385 / 2101 |
| Engine capabilities | 115 / 115 implemented |
| Test suite | 403 passing (`npm test`), `npm run typecheck` clean |

**Seed 2, Seed 3, and Shade of the Devoured Emperor are fully implemented
and audited** — every card with rules text is `authored`/`verified`, its
JSON checked against the printed text + the CR, all referenced capabilities
implemented. The three sets exercise ~115 capabilities; new sets should
mostly reuse that vocabulary.

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
of the Devoured Emperor additions" and `RULES.md` §12. Four printed clauses
left as `parityGaps` (`opponent-may-pay-to-counter` — a pre-stack player
buyout; `search-and-develop-draw-interception`; `card-ignores-source-class`
— Parkour Hoodlum's location-immunity).

**Seed 3's 8 non-tournament "EPIC"/"Showdown" faction cards** have their
setup blocks + in-scope activated abilities authored from the card art
(`FactionDefinition.{abilities, meetsAllThresholds}`, `turn.{startOfTurnEffects,
develop.usesPerTurn}`, `ActivatedAbility.usableBy` — RULES.md §3.6). 4 are
`high`, 4 `medium`. Their unmodelled clauses (double-sided card-flipping,
Showdown multiplayer, cross-faction rule override, mixed starting-resources)
are recorded in the **`parityGaps`** registry in `data/card-coverage.json`
— see the "Parity gaps" section of `COVERAGE.md`.

**`parityGaps`** (new): a top-level `data/card-coverage.json` registry of
printed clauses deliberately left unmodelled because closing them needs a
large engine / game-format refactor. Distinct from `capabilities` (small
buildable additions) and `wontImplement` (whole card unmodellable) — a card
with a parity gap is still `verified` for its in-scope parts and links the
gap id. `card-data-integrity.test.ts` keeps the registry honest.

**The 107 `classified` cards** (Open Beta 40, 1st Edition 40, 2nd Edition
26, Ungodly Mess 1) are pre-existing `behavior` blocks, audited against
printed text + the CR — vocabulary-valid and faithful. Promoting them to
`authored`/`verified` just needs each driven through a real-JSON smoke
path.

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

### Remaining sets (smallest → largest `unclassified`)

| Set | `unclassified` | notes |
|---|--:|---|
| Holy Heist | 132 | 33 already vanilla — smallest remaining |
| Ungodly Mess | 161 | 1 already classified |
| 1st Edition Part 2 | 161 | |
| Open Beta | 144 | 40 prior-behavior cards already `classified` |
| 1st Edition | 162 | 40 prior-behavior cards `classified`; the two precon decks draw from here |
| Seed | 209 | |
| 2nd Edition | 256 | 26 prior-behavior cards `classified` |
| Seed Saga | 340 | largest; long tail of one-offs likely |

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
