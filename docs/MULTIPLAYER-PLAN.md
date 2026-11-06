# Multiplayer plan & progress tracker

Durable resume point for the multi-session effort that adds **free-for-all**
(3+ players) and **Showdown** (Villain vs Heroes) table modes, plus an
**epic** deck-legality flag, to an engine that was written for exactly two
players. Classic two-player behavior must not change.

Work happens on branch `multiplayer`. To resume: read this file top to
bottom, then `git log --oneline main..multiplayer`. Update the checklist and
the **Next action** line at every checkpoint.

**Next action:** Phase 0 agents running (atoms source, classic oracle, epic
legality, rarity sweep, card audit ×4). Lead: Phase 1 types.

## Sources

The only official text for these formats is three printed rules insert cards
(the Comprehensive Rules 2.5 and FAQ 2.0 have no multiplayer content):

- [`docs/rules/multiplayer-guidelines.md`](rules/multiplayer-guidelines.md) — atoms `MP n`
- [`docs/rules/showdown-rules.md`](rules/showdown-rules.md) — atoms `SD n`, `SD-EA n`, `SD-SLE n`
- [`docs/rules/epic-rules.md`](rules/epic-rules.md) — atoms `EP n`

Photos of the cards: `docs/rules/source/*.jpg`.

## Decisions

- **D1 Modes.** `GameFormat` is `classic` (exactly 2) | `freeForAll` (2+) |
  `showdown` (1 Villain + 2+ Heroes). Epic is orthogonal: a deck-legality
  option (`allowEpic`, `limited`, `tournament`), not a mode. (user, 2026-11-06)
- **D2 Allegiance.** The real Allegiance card set is unknown. Model it as a
  configurable allegiance deck (`AllegianceDeckConfig`) with a default, behind
  a single module; the rest of the engine reads loyalty only via
  `getLoyalty(id)` / `isAllegianceRevealed(id)` so the real cards can be
  swapped in later. (user, 2026-11-06)
- **D3 Elimination & winners.** A player whose faction reaches 0 influence is
  eliminated; play continues. FFA: last player standing wins. Showdown:
  Villain eliminated → loyal Heroes win (including already-eliminated loyal
  Heroes); every loyal Hero eliminated → Villain + traitors win. Simultaneous
  final eliminations → draw. `(engine-derived)` (user, 2026-11-06)
- **D4 Opponent binding.**
  - Activated / triggered / onPlay / tactic text is one "block of rules
    text" (MP 2). It binds **one** opponent for its whole resolution
    (`ResolutionContext.opponentId`). The player is prompted only if more than
    one candidate exists — classic never prompts.
  - "Both players" in such a block = controller + bound opponent (MP 3).
  - Static `ContinuousAbility` text that says "opponent" applies to **every**
    opponent (it can't stop to ask).
  - BUT anything a resolved block **creates** (area modifiers, lingering /
    scheduled effects, hand-move redirects, created abilities) stays bound to
    the opponent that block chose — "choose an opponent; that player's
    characters get -1 this turn" affects only that player.
  - A card that chooses an opponent as it enters play stores it
    (`CardInstance.chosenOpponentId`); its statics then apply to that player
    only.
  - Explicit "each opponent" / "all opponents" / "each player" fan out via
    `forEachPlayer`. (user, 2026-11-06)
- **D5 Seats.** `GameState.turnOrder` is explicit. Seats 2..N use the
  faction's `goingSecond` opening hand. `(engine-derived)`
- **D6 Priority.** After player A acts, priority rotates through every other
  living player in seat order; the top item resolves once all of them pass
  in a row. A response restarts the rotation after the responder. You still
  never respond to your own action. `(engine-derived)`
- **D7 Blocking.** Only the defending player blocks (no allied blocking in
  Showdown). `(engine-derived)`
- **D8 Elimination cleanup.** An eliminated player's owned cards leave the
  game; cards they control but don't own return to their owners; their stack
  items, pending triggers and scheduled / created effects are dropped.
  `(engine-derived)`
- **D9 Faction "your opponent" rules.** Knitting Coalition
  (`overridesOpponent`) and Union of Unextraordinary Miners
  (`matchOpponentCount`) are setup / standing rules → apply to every
  opponent (D4 statics). `(engine-derived)`

## Execution conventions

- Subagents: Sonnet only, ≤ 8 concurrent (user, 2026-11-06). Only for
  file-disjoint work. Agents that run tests or edit TypeScript work in a git
  worktree so they don't see the lead's half-edited engine.
- `SpoilsEngine.ts` and `src/types/` are edited serially by the lead.
- Card data changes go through `node scripts/patch-cards.cjs <patch.cjs>`;
  agents write patch modules, the lead applies them.
- RULES.md is edited by the lead only (agents return proposed text).
- Checkpoint gate: `npm test`, `npm run typecheck`,
  `npm run build && npm run typecheck:consumer`,
  `node scripts/build-coverage.cjs --check`, classic oracle replay identical.

## Checklist

### Phase 0 — Sources & safety net
- [x] Transcribe the three rules cards → `docs/rules/*.md` with atoms
- [x] This tracker
- [ ] Rules-suite atom source `data/rule-tests/source/multiplayer.txt` +
      `_atoms.ts` / CLI support + batches `r13-multiplayer`, `r14-showdown`,
      `r15-epic`
- [ ] Classic regression oracle: seeded autoplay transcripts recorded from
      the pre-refactor engine + replay test asserting identical output

### Phase 1 — Types (`src/types/`)
- [ ] `GameFormat`, `GameState.format`, `turnOrder`
- [ ] `PlayerState.eliminated`, `turnsBegun`, Showdown `side` / allegiance
- [ ] `GameResult` replaces `GameWinner`
- [ ] `ResolutionContext.opponentId`; `opponentId` on `playCard` /
      `activateAbility`; `chooseOpponent` pending choice
- [ ] `alternatingPay` tuple → arrays / records
- [ ] `forEachPlayer` fan-out effect; `chooseOpponent` effect;
      `CardInstance.chosenOpponentId`
- [ ] Faction schema: expression-valued `startingInfluence` /
      `startingResources.count` (`opponentCountAtStart`), develop repeat,
      `usableBy: "heroes"`
- [ ] `src/types/showdown.ts`

### Phase 2 — Core engine N-player refactor
- [ ] Seats & opponents: replace `getOpponent` (29 callers) with
      `nextSeat` / `opponentsOf` / `boundOpponent`; unify
      `scopeMatchesPlayer`, `selectorPlayerMatch` and inline copies
- [ ] Turn order + turn-parity arithmetic → per-player turn scheduling
- [ ] Priority rotation (D6)
- [ ] Setup: `createFactionGame(defs, players[], { format })`,
      `createGame(players[], cards)`; fixture `buildGame({ players })`
- [ ] Battle defender selection
- [ ] Elimination + `GameResult` (D3, D8)
- [ ] Two-party constructs bound to controller + bound opponent
      (alternatingPay, auction, partitionAndPick, seat swap);
      `forEachPlayer` / `anyPlayerMayPay` rotate all seats
- [ ] Persistence version bump; redaction of Allegiance

### Phase 3 — Opponent binding & card audit
- [ ] Static "references an opponent" analysis per block; binding at play /
      activate / trigger; created effects capture `opponentId`
- [ ] Card audit → `data/multiplayer-audit/*.json` (spec below)
- [ ] Apply category (b)/(c) fixes; 3-player tests for (b)/(c)/(d)

### Phase 4 — Showdown
- [ ] `src/engine/showdown.ts`: opponent rule (SD 13–15), allegiance dealer
- [ ] Hero Deck & Temptation Pile shared zones; claiming (SD 8–10)
- [ ] Re-encode The Evil Alliance (SD-EA) and Slightly Less Evil Alliance
      (SD-SLE)
- [ ] Setup validation

### Phase 5 — Epic legality & card data
- [ ] `isEpicCard`, deck options, issue kinds (EP 2–4), export
- [ ] Data-integrity test pinning the epic set
- [ ] Rarity-strip image sweep for unmarked epic printings

### Phase 6 — Docs & hardening
- [ ] RULES.md §15 Multiplayer, §16 Showdown; rewrite §3.6 note
      (`RULES.md:375-379`); N-player wording in §1/§5/§7
- [ ] BEHAVIORS.md, TESTING.md, README.md
- [ ] r13–r15 atom tests; `mark-done`
- [ ] Fuzz: 3/4/5-player FFA, Showdown 1v2/1v3/1v4 with traitors
- [ ] `examples/showdown.ts`

## Card audit spec (Phase 3)

One JSON file per set group in `data/multiplayer-audit/`. Each entry:

```json
{
  "name": "Card Name",
  "ids": ["<every printing id with this name>"],
  "category": "a" | "b" | "c" | "d",
  "phrases": ["the printed player-relative phrases, verbatim"],
  "notes": "why; for b/c the exact behavior change needed",
  "ruling": "for d: the proposed engine-derived reading"
}
```

Categories, judged against D4:

- **a — works by binding.** Every "opponent"/"your opponent" in a
  resolving block means one chosen opponent, and every static "opponent"
  means "each opponent". No data change.
- **b — needs fan-out.** Printed "each opponent", "all opponents",
  "each player", "all players" (or a static/effect whose current encoding
  picks one player where the text means all) → wrap in `forEachPlayer`.
- **c — needs re-encoding** for another reason: "another player",
  "any player", "choose a player", "both players" encoded in a 2-player
  way, seat swaps, alternating pays / auctions / partitions, a static that
  should read a stored `chosenOpponentId`, faction rules naming the
  opponent.
- **d — ambiguous in multiplayer**, needs a ruling (e.g. "your opponent's
  turn", "if your opponent controls more…", effects that compare you to
  "your opponent" as a whole).

## Open questions

- Q-MP1: Allegiance deck composition (D2 placeholder default: Heroes − 1
  loyal cards + 1 traitor card for 3+ Heroes, all loyal for 2 Heroes?) —
  pending the real cards.
