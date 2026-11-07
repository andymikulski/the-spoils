# Multiplayer plan & progress tracker

Durable resume point for the multi-session effort that adds **free-for-all**
(3+ players) and **Showdown** (Villain vs Heroes) table modes, plus an
**epic** deck-legality flag, to an engine that was written for exactly two
players. Classic two-player behavior must not change.

Work happens on branch `multiplayer`. To resume: read this file top to
bottom, then `git log --oneline main..multiplayer`. Update the checklist and
the **Next action** line at every checkpoint.

**Next action:** Phase 7 is green in every mode (gate runs in CI); D10 applied. Commit the work (blocked on GPG unlock), then the Known follow-ups. Q-MP1 (allegiance composition) waits on the user.

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
- **D10 The printed card + the guidelines decide (user, 2026-11-06).** "If the
  rules say what to do, do what the rules say": no wider "every player" house
  readings. Printed "both players" is MP 3 (controller + selected opponent),
  "that player ... their opponent" is MP 2 from that player's seat
  (`asPlayer`), singular "your opponent cannot respond" shuts out only the
  opponent the card is played against (`noResponse: "opponent"`). Each
  printing as printed (`docs/CARD-DATA.md`), not the archival `text`.

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
- [x] Rules-suite atom source `data/rule-tests/source/multiplayer.txt` +
      `_atoms.ts` / CLI support + batches `r13-multiplayer`, `r14-showdown`,
      `r15-epic`
- [x] Classic regression oracle: seeded autoplay transcripts recorded from
      the pre-refactor engine + replay test asserting identical output

### Phase 1 — Types (`src/types/`)
- [x] `GameFormat`, `GameState.format`, `turnOrder`
- [x] `PlayerState.eliminated`, `turnsBegun`, Showdown `side` / allegiance
- [x] `GameResult` replaces `GameWinner`
- [x] `ResolutionContext.opponentId`; `opponentId` on `playCard` /
      `activateAbility`; `chooseOpponent` pending choice
- [x] `alternatingPay` tuple → arrays / records
- [x] `forEachPlayer` fan-out effect; `chooseOpponent` effect;
      `CardInstance.chosenOpponentId`
- [x] Faction schema: expression-valued `startingInfluence` /
      `startingResources.count` (`opponentCountAtStart`), develop repeat,
      `usableBy: "heroes"`
- [x] `src/types/showdown.ts`

### Phase 2 — Core engine N-player refactor
- [ ] Seat swap (Emergency Obfuscation) — asserts two living players (`soleOtherSeat`) until an E6 ruling
- [x] Seats & opponents: replace `getOpponent` (29 callers) with
      `nextSeat` / `opponentsOf` / `boundOpponent`; unify
      `scopeMatchesPlayer`, `selectorPlayerMatch` and inline copies
- [x] Turn order + turn-parity arithmetic → per-player turn scheduling
- [x] Priority rotation (D6)
- [x] Setup: `createFactionGame(defs, players[], { format })`,
      `createGame(players[], cards)`; fixture `buildGame({ players })`
- [x] Battle defender selection
- [x] Elimination + `GameResult` (D3, D8)
- [ ] Two-party constructs bound to controller + bound opponent
      (alternatingPay, auction, partitionAndPick, seat swap);
      `forEachPlayer` / `anyPlayerMayPay` rotate all seats
- [x] Persistence version bump; redaction of Allegiance

### Phase 3 — Opponent binding & card audit
- [x] Static "references an opponent" analysis per block; binding at play /
      activate / trigger; created effects capture `opponentId`
- [x] Card audit → `data/multiplayer-audit/*.json` (spec below)
- [x] Apply category (b)/(c) fixes; 3-player tests for (b)/(c)/(d)

### Phase 4 — Showdown
- [x] `src/engine/showdown.ts`: opponent rule (SD 13–15), allegiance dealer
- [x] Hero Deck & Temptation Pile shared zones; claiming (SD 8–10)
- [x] Re-encode The Evil Alliance (SD-EA) and Slightly Less Evil Alliance
      (SD-SLE)
- [ ] Setup validation

### Phase 5 — Epic legality & card data
- [x] `isEpicCard`, deck options, issue kinds (EP 2–4), export
- [x] Data-integrity test pinning the epic set
- [x] Rarity-strip image sweep for unmarked epic printings

### Phase 6 — Docs & hardening
- [x] RULES.md §15 Multiplayer, §16 Showdown; rewrite §3.6 note
      (`RULES.md:375-379`); N-player wording in §1/§5/§7
- [x] BEHAVIORS.md, TESTING.md, README.md
- [x] r13–r15 atom tests; `mark-done` (r15-epic done)
- [x] Fuzz: 3/4/5-player FFA, Showdown 1v2/1v3/1v4 with traitors
- [x] `examples/showdown.ts`

### Phase 7 — Every test at every table (the acceptance gate)

Goal: every existing test — unit, per-card, clause, rules, oracle (~43.7k) — passes
unchanged at bigger tables. `SPOILS_TABLE=<mode>` re-seats every two-player
`buildGame` board (`src/engine/__tests__/support/bystander.ts`):

| Mode | Seats | Format |
|---|---|---|
| `classic` | P1, P2 | classic |
| `ffa3` | P1, P2, B1 | freeForAll |
| `ffa4` | P1, B1, P2, B2 | freeForAll |
| `showdown` | P1 Villain; P2, B1, B2 loyal Heroes | showdown |

The extra seats are passive (pass priority, decline, end their turns); each test's
two-player meaning is kept (the other original player is named as "your opponent";
the result is judged between the original two). Expected: identical to classic. A
failure in a mode = something a bigger table changes → classify:
- **harness** — the test or wrapper assumes two seats in a way the rules don't (fix the harness/test, not the engine);
- **card data** — the card's encoding is wrong at a bigger table (patch + 3-player test);
- **engine** — a rule/capability gap (written up; fixed by the lead, serially).

Run: `npm run test:tables -- <mode>` (`scripts/table-matrix.cjs`) → `.work/table-matrix-<mode>.json`
(failures with file / test / error; raw TAP of any failing group in `.work/table-matrix-<mode>-group<n>.tap`);
one file: `node scripts/table-mode-file.cjs <mode> <file>`. Exits non-zero on any failure. Tests built with `createFactionGame` or
`buildGame({ players })` already choose their own table and run once.

- [x] Baseline ffa3 / ffa4 / showdown (failure counts per suite below)
- [x] Triage + fix by suite/set (agents, worktrees; engine gaps to the lead)
- [x] All modes green; add `npm run test:tables` and run it in CI (`tables` job, one per mode)

| Mode | Tests | Failing | Notes |
|---|---|---|---|
| ffa3 | 43,784 | 339 → 0 | first run's dominant cluster was harness (extra seat's own start-of-turn prompts) |
| ffa4 | 43,784 | 765 → 0 | same cluster, twice the extra seats |
| showdown | 43,784 | 317 → 0 | same cluster |

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

## Card audit results (2026-11-06)

`data/multiplayer-audit/g1..g4.json`: 318 distinct cards — **a 228 · b 19 ·
c 62 · d 9**. Generic engine capabilities the audit calls for (handle these
before per-card fixes; most c-cards collapse onto one of them):

- **E1 `forEachPlayer` opponents-only scope.** `forEachPlayer` includes the
  controller today; "each opponent" cards proxy it with `not isActivePlayer`
  (Free Trade Agreement, 3p1ph4ny 31f). Add a `players: "opponents"` scope.
  Existing fan-outs (Quotidian Transposition, Breath of the Barduse, Tempered
  Rage) rely on `controller` / `owner:"self"` rebinding to the iterated
  player — test that.
- **E2 Opponent bound by a pick.** "Pick an opponent" / a pick of an
  opponent's card or faction (`owner:"opponent"` target, `otherPlayerChooses`
  cost) should *set* the block's `opponentId` (before costs / X evaluate)
  instead of prompting separately. Lazy binding: a block whose only opponent
  reference is a target selector binds from the pick.
- **E3 Event-player binding.** Triggers on an opponent's event
  (`eventPlayerIs: opponent`, `eventCardControlledBy: opponent`, "when an
  opponent attacks") bind `opponentId` to the event's player, no prompt
  (Sadistic Colonel, Meat of the Mountain, Akashic Coin, Lugubrian Octopod,
  Master General). Attack-related triggers bind the attacker/defender
  (Bask Bomb, Wyrmfang Deathskull, Candy Skull Commander, Runivoltaic
  Accumulator — whose `battleRole: defender` proxy is 2-player-only).
- **E4 Existential vs per-opponent quantifiers in statics / conditions.**
  `count` over `controller:"opponent"` sums all opponents — right for "your
  opponents' X", wrong for "an opponent controls ≥ N" or "more than you"
  (Adroit Marauder, Face in the Crowd, Nefarious Horror, Omahkapi'si Pi'kssii,
  Martial Arts Wannabe, Recreant Cad, Trophy Collector, Slingerang,
  Shriever General). Need an "any opponent satisfies" quantifier; when later
  effects say "that opponent", bind the qualifying one.
- **E5 `anyPlayerMayPay` opponents-only mode / "any opponent may pay"** in
  seat order (Additional Tribute, Offering of False Friendship, Thabbashite
  Barbeque, Unloyal Necromorph, Tedious TriAdic Truculence, Recycling Scheme
  Facility).
- **E6 Two-party constructs → N-party where the text says so.** Auction
  House: every living player bids in seat order. `partitionAndPick`
  (Mustache Aficionado / Showdown): controller + bound opponent. Emergency
  Obfuscation seat swap: controller + bound opponent.
- **E7 `emptyDeckLoses` → elimination** under D3 (Trickster's Globe).

**Suspected latent 2-player bugs** (auditor claims — verify with a classic
test before fixing): Irresistible Bribe, Scrag, Caboodling Gladhander (bound
opponent used where the *target's controller* is meant — wrong when you
target your own card), Needless Beating (unrestricted character pick),
Lecram (look at an opponent's top card — unencoded). Equivalent-in-2p but
should move to `controllerOf` the picked/event card for N players: Blow Up,
Splattergun, Redonkulous, Ritual of the Knob & Pull, Smothering Corpulence,
Clockman Pickpocket, Cute Cutpurse, Deceptive Muddler, Mendacious Brigand.

## Progress log

- 2026-11-06 — Phase 0 sources + tracker. Card audit (318 cards). Epic legality (`deckRules.ts`, RULES.md §15, r15-epic done). Rarity sweep: OCR + visual over all 2257 printings — exactly the 7 known epic printings, no data change needed. Rules suite gains the MULTIPLAYER source (40 atoms, batches r13–r15). N-seat setup (`createGame`, `createFactionGame`, `seating.ts`, `showdown.ts`). `getOpponent` removed: opponent set semantics, `ResolutionContext.opponentId`, priority rotation via `ResponseWindowState.stackResponders`, battle responders, N-bidder auction. `scripts/run-tests.cjs` passes relative paths (Windows command-line limit in deep worktrees). Agent worktrees branch from `main` — brief agents to `git merge --ff-only multiplayer` first.

- 2026-11-06 (cont.) — Classic oracle merged (31 real-catalog games; replays identically after every engine step so far). `GameResult` replaces `winner` (save format 2 + v1 migration). Elimination (D3/D8) incl. Showdown sides and eliminated-turn passing. Seat-aware next-turn numbering (`turnNumberOfNextTurn`). `buildGame({ players, format })` fixture. Opponent binding: `opponentId` on playCard / activateAbility / flipUp, `opponent` play requirement, E2 (pick), E3 (event), `chooseOpponent` prompt for triggers, E4 existential condition evaluation (`conditionNodeRefersToOpponent`). Multiplayer tests: `src/engine/__tests__/multiplayer/{seating,elimination,binding}.test.ts`.
- **Audit caveat (2026-11-06):** the auditors judged the archival `text` field; each printing plays as *printed* (`markup` / `data/card-audit/corrections.json`). The latent-bug agent found most "classic bugs" were faithful to the printed "your opponent" wording. Real fixes merged: Lecram (both looks were unencoded), Redonkulous + Smothering Corpulence (Seed Saga / DoD printings say "that character's controller" → `controllerOf`). Audit entries are being re-checked against printed text.

- 2026-11-06 (cont.) — E1 `forEachPlayer { players: "opponents" }`, MP 3 `"controllerAndOpponent"`, E5 `anyPlayerMayPay { players: "opponents" }`; D4 created effects keep `opponentId` (area modifiers, scheduled effects, runtime replacements, hand-move redirects); E3 also binds the current battle's sides. Showdown engine: `table` zone, Allegiance dealing + redaction, Hero Deck / Temptation Pile, `claimHeroCards` / `heroDeckToTemptationPile` / `revealAllegiances`, `usableBy: "heroes"`, PlayerRef `"villain"`, selector `controller: "otherHero"` + `showdownPile`, `opponentCountAtStart`, `influencePerOpponent` / `countPerOpponent` / `develop.usesPerOpponent`, `daringGambit`. Fuzz (`multiplayer/fuzz.test.ts`, 18 real-deck games) found and fixed: eliminated battle side left a dangling battle continuation; seat swap at 3+ seats; autoplay could not answer trigger prompts (probe lacked the trigger queue) or distinct-name picks. Audit re-checked against printed text: a 251 · b 19 · c 35 · d 13. RULES.md §16 Multiplayer, §17 Showdown.

- 2026-11-06 (cont.) — r13-multiplayer, r14-showdown, r15-epic all done (15/15 rules batches). r14 found three `claimHeroCards` mismatches, fixed: a playable claimed tactic must be played (SD 9), an unplayable one is removed at once (SD 10), the rest of a claim survives a tactic. The Evil Alliance and Slightly Less Evil Alliance re-encoded (full fidelity; clause tests converted from TODO; oracle games 501/502 re-recorded as an intended data change). Elimination re-stamps turns counted ahead; `startOfOpponentNextTurn` follows the bound opponent. RULES.md §16/§17, BEHAVIORS.md, README, `examples/showdown.ts`.

- 2026-11-06 (cont.) — Per-card multiplayer fixes merged: audit g1/g2 (17 cards / 33 printings re-encoded, 11 verified, 11 d-rulings pinned; `per-card/multiplayer-g12.test.ts`, 78 tests) and g3/g4 (27 of 31 cards re-encoded; `per-card/multiplayer-g34.test.ts`, 56 tests). Classic oracle unchanged by both. Engine: conditions alone never need an opponent named; replacements bind the affected opponent; mid-resolution with nobody to ask → first candidate; a block bound to an eliminated opponent reaches nobody; effect-frame resume order fixed (a list's remainder waits below what its paused effect parked).

- 2026-11-06 (cont.) — Phase 7 green: every test passes at ffa3 / ffa4 / showdown tables, classic unchanged (oracle identical). Split by suite among 5 Sonnet agents (seed, saga, heist, classic, unit) plus the lead's engine batches. Engine: `playerRefIncludes` (cost modifiers / pick taxes say "opponent" = any opponent), Duplicate keeps the right opponent, nested free deploys inherit the enclosing block's opponent, `getPlaySelectionInput` takes `opponentId`, an optional replacement whose chooser is "opponent" is offered to each affordable opponent in turn (Unloyal Necromorph), Emergency Obfuscation's seat swap (Q-MP2). Card data: Dragon Tank ×3 (no opponent has a character), `mayPay anyOf: "opponents"` for Additional Tribute / Offering of False Friendship / Thabbashite Barbeque / Tedious TriAdic Truculence, Obscene Communion (Seed) `controllerAndOpponent`. The rest were harness/test assumptions of two seats (tests resolving effects directly now name their opponent; two-player-only rules tests pin `players`). The matrix parser had hidden failures behind their suites' summaries; fixed. Scan: Dragon Tank was the only "your opponent has none" (universal) condition in the catalog.

- 2026-11-06 (cont.) — D10 (user: follow the rules). New `asPlayer` effect ("that player ... their opponent": the body runs as that player with an opponent they select; `chooseOpponent` can now be asked mid-resolution) and `noResponse: "opponent"` (`StackItem.unanswerableBy`). Re-encoded to the printed text + MP 2/3: Community Chest, Ambiguity Embiggener, Free Trade Agreement ×3, Thabbashite Wizard (Seed), Gambling Den (Seed), Lucky Bastard (Seed 2), Meat of the Mountain, and the 12 singular "your opponent cannot respond" printings. Mercenary's Creed / Knitting Coalition stay usable by any player (the user is "you" for that block). Catalog scan: no other printed "both players" reaches every player. All identical at two players.

- 2026-11-06 (cont.) — Functional parity (user: "we will not accept anything below functional parity save for the multiplayer bits"). Engine: a card nobody may respond to resolves as though everyone had passed (`resolveUnanswerable` → `reopenOrCloseResponseWindow`; the old inline path left an emptied window open with the responder holding priority, and never reopened it after a mid-resolution prompt); a replacement's effects run as one atomic frame — a pause makes the rest wait (the old loop ran it ahead: Grasp of Rantzigore destroyed before the discard), no state-based check / trigger between them in nested lists too, and the CR 506.5 guard lasts across the pause (`ResolutionContext.replacing`); elimination also drops what was still to resolve as the eliminated player and delayed effects waiting for their turn. No opponent is ever taken by default (MP 2): a card an effect plays names its own (`deployForFree` / `resourceReveal` `opponentId`), a replacement on your own card asks, the "first in turn order" fallback is an error. SD 2 / SD 3 / SD 5 held at setup (`FactionDefinition.showdownRole`). Per-player scopes: `restrictBlockers.notBy` (Underhanded Gamer Saga), `pickerWhere` (Omahkapi'si Pi'kssii), `usableBy: "controllerAndOpponent"` + per-card `createdAbilities` (The Open R&D Faction). The Billionaire: the borrower selects the owner's opponent (MP 2), not always themselves. Data: TRUE COLORS on the Villain's turn (oracle games 501/502 re-recorded: verified the only classic difference), Thabbashite Barbeque's hand look one selected opponent. Oracle otherwise identical.

- 2026-11-07 — Save / load is lossless. Everything the engine kept between actions on the instance now lives in the state: `GameState.triggerQueue` (was `immediateQueue`; the "held behind a paused trigger" guard is `TriggerResolution.heldForParkedFrames`) and `GameState.bookkeeping` (`EngineBookkeeping`: last-known information, departed tokens, cards entered this action, Unique bookkeeping, damage tallies, lethal battle-damage causes, deploy origins). `redactStateFor` drops both. `saveGame` records the objects the state shares between places (`SerializedGame.sharedObjects`; a paused effect list shares its context with the prompt it waits on) and `loadGame` links them again; departed tokens' definitions travel in `runtimeDefinitions`. New test: save → JSON → load before every action of every oracle game, the loaded game plays on identically (`oracle/save-load-equivalence-*.test.ts`). Oracle games 103, 301, 302, 603, 701, 1001 re-recorded with the user's OK: the test bot's legality copy (`autoplay.ts` `simulateLegal`) now carries the queued triggers, so it no longer refuses legal trigger-prompt answers; with the old copy restored all 31 games replay as recorded, i.e. the engine plays identically.

## Known follow-ups

None open. Every item that was listed here (2026-11-06) was an implementation shortcut, not the rules, and is fixed
(see the progress log). New ones go here — and a difference between table sizes that the rules do not call for is a
bug to fix, not a follow-up to log.

## Open questions

- Q-MP2 (resolved 2026-11-06): Emergency Obfuscation swaps its controller with the opponent it was played against (MP 3 "both players"); the table matrix confirmed this keeps every two-player test identical.

- Q-MP1: Allegiance deck composition (D2 placeholder default: Heroes − 1
  loyal cards + 1 traitor card for 3+ Heroes, all loyal for 2 Heroes?) —
  pending the real cards.
