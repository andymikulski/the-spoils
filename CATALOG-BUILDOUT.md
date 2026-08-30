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
| `verified` (smoke-tested through the public API) | 51 |
| `authored` (behavior JSON written, fixture-tested by shape) | 97 |
| `classified` (audited, not yet smoke-verified) | 107 |
| `vanilla` (no behavior needed) | 156 |
| `unclassified` | 1690 |
| `rulesAudited` | 260 / 2101 |
| Engine capabilities | 65 / 65 implemented |
| Test suite | 349 passing (`npm test`), `npm run typecheck` clean |

**Seed 2 and Seed 3 are fully implemented and audited** — every card with
rules text is `authored`/`verified` at `high` confidence, its JSON verified
against the printed text + the CR, all referenced capabilities implemented.
Between them the two sets exercise ~65 capabilities; new sets should mostly
reuse that vocabulary rather than grow it.

**Seed 3 data gap:** the 8 parody *faction* cards (The Evil Alliance,
Imperial Army, Counter-Imperial Army, Slightly Less Evil Alliance, The
Knitting Coalition, The Open R&D Faction, The Society of Magical Propriety,
The Union of Unextraordinary Miners) have **no rules text in the source
dump** (`data/raw-database.json`). Their faction setup blocks are
placeholders copied from the base Tournament Faction — structurally valid
and engine-consumed, but not verifiable against the real card. They sit at
`medium` confidence until the printed cards are available.

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
| Shade of the Devoured Emperor | 125 | |
| Holy Heist | 132 | 33 already vanilla |
| Ungodly Mess | 161 | 1 already classified |
| 1st Edition Part 2 | 161 | |
| Open Beta | 144 | 40 prior-behavior cards already `classified` |
| 1st Edition | 162 | 40 prior-behavior cards `classified`; the two precon decks draw from here |
| Seed | 209 | |
| 2nd Edition | 256 | 26 prior-behavior cards `classified` |
| Seed Saga | 340 | largest; long tail of one-offs likely |

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
