# Hidden-information & fidelity plan

**DONE (2026-09-01).** All phases landed. Canonical record: CATALOG-BUILDOUT.md
"Fidelity pass", RULES.md §12 "Fidelity pass", BEHAVIORS.md "Fidelity pass".
Result: `CARD_FIDELITY` export (2096 full / 3 partial / 2 stub), 6 engine
additions + 1 bug fix, ~15 cards re-authored, `fidelity-fixes.test.ts`,
`PlayerBoard.tsx` renders `flow.revealed`. Kept below as the design trail.

---

Close the "verified ≠ faithful" gap for the reveal / look-at / hidden-info
card family, and give downstream a machine-readable fidelity marker.

## Findings (audit: `.work/hidden-info-audit.txt`, 182 distinct cards)

Most "reveal" text is **already faithful**: "search your deck for X, reveal
it, put in hand" — revealing to a perfect-information engine is a no-op with
no mechanical content, and matches how the card actually plays. The real
gaps:

| Bucket | Cards | Status |
|---|---|---|
| **dig-from-top-until-match** | Surprise! (×2), Auction House (×2 — already bespoke) | Surprise! modelled as a whole-deck search — over-permissive, no shuffle. **real gap** |
| **look at top N, take matching → hand/void, reorder rest** | Intellectual Reliquary (×2), Auspicious Arrival, Mustache Aficionado (×2 — already bespoke), Gilda | take-to-hand/void dropped, modelled as plain scry. **real gap** |
| **deploy-from-zone else→hand/deck** | Warmachine Smelder | decline path drops the found card. **real gap** (the other 5 hand-roll it with `chooserSelectsOption` — fine) |
| **"X revealed at all times"** | Cheats McGuillicutty (×2), Odious Diva (×2), Axeclaw Grandchest, Bottlebeard Brandyshanks | buffs that key off it (Axeclaw/Bottlebeard) already read `deckPosition` directly — **faithful**. The passive reveal itself is renderer-only. **info-model gap** |
| **one-shot "look at" / "reveal"** | ~50 (Lecram, Forbidden Knowledge, Sly Bilker, Rigged Tables, all "look at opp hand"…) | the *decision* is modelled; "look" has no mechanical content → **faithful**, but no renderer signal |
| **misc concessions** | A Death Fit for a King (discard not opp-scoped), Ecto-Distillation ("any number of copies" = big count), Confessions/Eccentric Inquisition ("in any order" after partition) | minor |

## Plan

### Phase 0 — fidelity marker (ship first)
- `data/card-coverage.json`: add `fidelity: "full" | "partial" | "stub"` per
  card. `stub` = the 2 `wontImplement`. `partial` = a documented concession
  materially changes play (derived: `confidence !== "high"` AND notes carry
  concession language, OR linked `parityGaps`). Everything else `full`.
- `scripts/build-coverage.cjs` computes + validates it; emits lean
  `data/card-fidelity.json` `{ [id]: { fidelity, note } }`.
- `npm run sync-cards` generates `src/data/cardFidelity.js`; `src/data.ts`
  re-exports `CARD_FIDELITY`.
- `card-data-integrity.test.ts`: every card has a `fidelity`; `stub` ⇔
  `wontImplement`.

### Phase 1 — engine primitives
1. `revealFromTopUntil` effect — reveal from top of a deck until `match`
   holds or exhausted; bind the matched card; run `onMatch`; `rest:
   "shuffle" | "bottom" | "discard"` the other revealed cards. Emits
   `cardsRevealed`. Backs **Surprise!**; **Auction House** refactored onto it.
2. `lookAndReorder.take?: { chooser, selector, count, to: "hand"|"void" }` —
   "look at top N, take up to `count` matching → `to`, reorder the remainder
   per `to`(top/bottom/split)." Backs **Intellectual Reliquary**, **Gilda**,
   tightens **Confessions**.
3. `deployFromZone.elseTo?: "hand" | "deckTop" | "deckBottom"` — the standard
   "if you don't, put it …" fallback. Backs **Warmachine Smelder**.

### Phase 2 — information model
4. `ContinuousAbility.grantsReveal?: { zone: "deckTop" | "hand"; of:
   PlayerRef; to: PlayerRef }` → `GameState.revealed: { deckTop:
   Record<PlayerId,PlayerId[]>; hand: Record<PlayerId,PlayerId[]> }`,
   recomputed in the continuous pass. Backs the "revealed at all times" cycle.
5. `reveal` one-shot effect + `cardsRevealed` event `{ byCardId?, viewerId,
   ownerId, zone, cardIds }` — informational; no lasting state (perfect-info
   engine). Backs Lecram / Forbidden Knowledge / Sly Bilker / Rigged Tables /
   all "look at opp hand" (added alongside the existing choice, not replacing).
6. `getFlowView()` surfaces `revealed` + the revealed card ids.

### Phase 3 — re-author + test
Re-author the ~15 real-gap cards (+ their reprints) onto the new primitives;
fixtures in `card-behaviors.test.ts`; extend per-set smoke; bump coverage to
`fidelity: full`, clear concession notes, `confidence: high` where earned.

### Phase 4 — spoils-game
- Render `flow.revealed` (opponent deck-top card face-up; opp hand face-up)
  + a `cardsRevealed` toast.
- `CARD_FIDELITY` consumption: `validateDeck` gains a `fidelity` policy
  (default: warn on `partial`, forbid `stub`); catalog UI badges non-`full`.
- Handle any new choice payloads (expect none — reuses `reorderDeck` +
  `chooserSelectsTarget`).
