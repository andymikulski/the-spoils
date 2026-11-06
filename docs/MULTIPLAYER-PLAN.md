# Multiplayer plan & progress tracker

Durable resume point for the multi-session effort that adds **free-for-all**
(3+ players) and **Showdown** (Villain vs Heroes) table modes, plus an
**epic** deck-legality flag, to an engine that was written for exactly two
players. Classic two-player behavior must not change.

Work happens on branch `multiplayer`. To resume: read this file top to
bottom, then `git log --oneline main..multiplayer`. Update the checklist and
the **Next action** line at every checkpoint.

**Next action:** Phase 7 — baseline the table-mode matrix (`ffa3`, `ffa4`, `showdown`) over the whole suite, then divide the failures among Sonnet agents by suite / set (triage → harness / card data / engine gap), engine gaps fixed by the lead in batches, until every mode is green.

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

Run: `node .work/mp-lead/run-matrix.cjs <mode> <repoDir>` → `.work/mp-lead/matrix-<mode>.json`
(failures with file / test / error). Tests built with `createFactionGame` or
`buildGame({ players })` already choose their own table and run once.

- [ ] Baseline ffa3 / ffa4 / showdown (failure counts per suite below)
- [ ] Triage + fix by suite/set (agents, worktrees; engine gaps to the lead)
- [ ] All modes green; add `npm run test:tables` and run it in CI

| Mode | Tests | Failing | Notes |
|---|---|---|---|
| ffa3 | 43,755 | 339 → (re-baselining) | first run; dominant cluster was harness (extra seat's own start-of-turn prompts) |
| ffa4 | 43,755 | 765 → (re-baselining) | same cluster, twice the extra seats |
| showdown | 43,755 | 317 → (re-baselining) | same cluster |

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

## Known follow-ups

- **Cards still waiting on an engine feature** (see each audit entry's `resolved`): Underhanded Gamer 8bed01de ("cannot be blocked by <player>" grant), Omahkapi'si Pi'kssii (pick restriction conditional on the picker), Unloyal Necromorph (optional replacement offered to every opponent), The Billionaire (borrowed ability's opponent should be the Billionaire), The Open R&D Faction (one created ability per player), Thabbashite Barbeque ("look at an opponent's hand" needs a mid-effect `chooseOpponent`), Meat of the Mountain (singular "that player's opponent").
- `anyPlayerMayPay` has no `elseEffects` and prompts players who cannot pay (the g34 cards use `forEachPlayer` + `mayPay` instead). Changing the prompt order alters classic games: re-record the oracle deliberately if done.
- `forEachPlayer` inside a replacement runs state-based checks mid-replacement (Lucky Bastard worked around it).
- The "keep every player" d-rulings (Community Chest, Free Trade Agreement, Ambiguity Embiggener, Mercenary's Creed) read "both players" more widely than MP 3 — confirm with the user.
- SD 2 ("The Villain uses The Evil Alliance faction") is not enforced at setup: any faction may sit in the Villain's seat (house-rule friendly). Enforce with a faction flag if wanted.
- `usesPerTurn` on the shared faction's abilities is keyed per card + ability, not per Hero (equivalent while they are own-turn only).
- Slightly Less Evil Alliance's TRUE COLORS uses `eventPlayerIs: "controller"` (the shared card is the Villain's), so it also ticks — harmlessly — in a classic game.
- Audit re-check findings to fold into per-card fixes: "both players" cards encoded as all-player `forEachPlayer` (Ashes of Zenobia, Research Investment, Spastic Tentacles, Tremor Engine, Hideous Hexapede de6f18) → `controllerAndOpponent`; printings that differ (Epic Smackdown 74da08, Lucky Bastard 451308, Brainbath 3bd6878a → fan-out; Mass Confusion da25a463 → picked player); Rocket Lawnchair `isActivePlayer opponent` → `not isActivePlayer controller`; noResponse cards printing singular "your opponent cannot respond" (Degenerate Molestation, Tactician Vacation, Voidal Replication) are d.

- A deploy made by an effect (no action to name an opponent) whose text needs one takes the first candidate in turn order; should prompt.
- An eliminated player's own in-flight pending choice is still theirs to answer (not cleared).

## Open questions

- Q-MP2: Emergency Obfuscation ("both players switch seats") at a table of three or more — engine-derived for now: it does nothing while more than two players remain. Alternative: swap with an opponent chosen as it enters play.

- Q-MP1: Allegiance deck composition (D2 placeholder default: Heroes − 1
  loyal cards + 1 traitor card for 3+ Heroes, all loyal for 2 Heroes?) —
  pending the real cards.
