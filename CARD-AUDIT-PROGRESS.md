# Card image audit

Goal: every printing in `data/cards.json` checked against its card image
(`data/assets/<id>.jpg`), so that every card's text, stats and behavior match
the real card, and every printing carries its printed flavor text.

Branch: `card-image-audit` in spoils-db (on top of `card-text-markup`).
Tooling: `npm run card-audit -- <command>` (`scripts/card-audit/cli.ts`).

## Resume here (new session)

State on 2026-10-15. Nothing is committed (the user commits). Branch `card-image-audit`.

- **Done:** every printing scanned (phase 1) and sample-verified (phase 2). `subtitle`/`flavorText` are on 2,100 printings. All 995 printings whose printed words differ from `text` show their printed words, via `data/card-audit/corrections.json` (by printing id) and regenerated markup. Stat, name, type and subtype fixes are done (see Decisions). Full suite passes.
- **Phase 4 (behavior), 2026-10-16:** 151 of 152 worklist items are done (`data/card-audit/behavior-worklist.md`). The one left is **Some Crazy Ornery Unfriendly Thug** (manual review: the content filter blocks reading its image, so a human must transcribe its flavor/subtitle and check its rules). Every fix is logged under Decisions and tested in `per-card/printed-variants.test.ts`. Every deferred engine item is done (see the Deferred table). Suite: 5174/5174; typecheck clean.
- **Open for the user:** Some Crazy Ornery Unfriendly Thug's manual image review (the user will do it later).
- **Rules to remember:** each printing plays and displays exactly as printed on its own card; `text` is never edited; problems get written down immediately; status updates stay short.
- **Commands:** `npm run card-audit -- check|progress|build-text [--all]|apply-flavor` · `npm run card-markup -- check` · `npm run sync-cards` · `npm test`.
- **Where things are:** scans `data/card-audit/scans/`, verify samples `data/card-audit/verify/`, generated findings `data/card-audit/findings.md`, markup flags `data/card-audit/markup-review.md`, image problems `data/card-audit/image-problems.json` (also listed in the table below).

## Deferred items (Sonnet sub-agents, per the user 2026-10-16)

Each agent writes its record to `data/card-audit/deferred/<slug>.md`. All card edits go through the locked `node scripts/card-audit/patch-cards.cjs <patch-module>` so parallel sessions can't overwrite each other. Nobody edits `data/cards.json` directly anymore.

| Item | Agent record | Status |
|---|---|---|
| Search "and reveal it" (engine vocabulary + per-printing data + spoils-game display) | `deferred/search-reveal.md` | **done.** The `revealCards` effect is on 107 printings (74 names) whose own text says reveal, plus a spoils-game table "reveal" moment. **After rewriting any behavior wholesale, re-run** `node scripts/card-audit/patch-cards.cjs data/card-audit/deferred/search-reveal.patch.cjs` (idempotent), and `other-reveals.patch.cjs` too. |
| Non-search reveals ("look at top N … reveal it", Rosy Palmer, Eccentric Inquisition, Meager Research) | `deferred/other-reveals.md` | **done.** 51 printings have reveal data and 18 reveal through the engine (face-down abilities, `revealFromHand`, Auction House, Mustache). After wholesale rewrites, re-run `node scripts/card-audit/patch-cards.cjs data/card-audit/deferred/other-reveals.patch.cjs` (idempotent). Not done: Slightly Less Evil Alliance (Showdown rules unmodeled). |
| Reveal follow-ups: spoils-game skips the reveal popup for the revealer even when they didn't know the card; Community Chest's mulligan reveal hook | `deferred/reveal-followups.md` | **done.** `cardsRevealed.knownToRevealer`, so the game shows reveals to a revealer who didn't know the card. New `cardsMulliganed` event, so Community Chest reveals during the mulligan as printed. |
| G8 threshold paragraphs modeled as free activated abilities | `deferred/threshold-paragraphs.md` | **done.** 18 printings across the 10 cards are now continuous abilities gated on resource icons. New `ContinuousAbility.destroysSource` covers Boorish Boar. `chooseDevelop` now runs state-based checks. A catalog-wide guard test was added, and no other offenders were found. |
| Emergency Obfuscation: the seat/side swap isn't modeled in any printing | `deferred/emergency-obfuscation.md` | **done.** `ContinuousAbility.swapsSides`: while it is in play, control of every card in play and the factions (and influence) swap; hands and decks stay with their owners. The winner is decided by faction owner. Ruling in RULES.md §12. New `GameFlowView.seatsSwapped`. |
| Threshold conditions ignore OMNIPOTENCE (`meetsAllThresholds`, The Evil Alliance): `resourceIcons` comparisons stay off | `deferred/omnipotence-thresholds.md` | **done.** New `meetsThreshold` condition (real icons or OMNIPOTENCE); all 85 printings with a leading-icon threshold paragraph migrated. Counting uses and inline "if you control [V][V][V]" checks still read real icons. It also fixed Cicibeo's stray ungated trigger. Decided 2026-10-16: the 9 inline "If you control [V][V][V], …" sentences keep counting real icons. Under CR 405 they are conditions, not thresholds, so this is rules parity. Side effect of the current rules: Boorish Boar dies on entering play under The Evil Alliance. |
| "your hand / your deck" vs owner's zones (Maladjustment, Recollection Bazaar, Foment, Two-Headed Coin) | `deferred/your-hand-zones.md` | **done.** `moveCard`/`moveSelected` now take `toPlayer`, and there's `CardInstance.heldBy`. Five printings play as printed. Two-Headed Coin's reflip had never been payable and now works. |
| A stolen card returned to its owner's hand keeps the thief as controller; spoils-game narration should use `heldBy` | `deferred/stolen-card-control.md` | **done.** A card that leaves play is now controlled by its holder (owner, or `heldBy`) once the move's events are out, so the owner can deploy a bounced steal. `cardDestroyed` carries the in-play controller for its triggers. `takeControl` ignores cards outside play. `narration.ts` uses `heldBy ?? ownerId`. |
| Printings missing from the catalog (collector-number gaps) | `deferred/missing-printings.md` | **done.** No numbered printing is missing; all three gaps are explained (Voidal Replication OB wrong image, Obsessive Concentration HH misprinted 043, the manual-review card). Possibly missing: the real ©2006 1st Edition staples (the 5 filed there are Part 2 staples), Seed 3 multiplayer/full-art extras, 2 UM Epoch Edition ultra rares, and a HH Deception art variant (two identical files). Decade of Deckadence is a precon starter box, not a set (user, 2026-10-16), so nothing is missing. |
| The Billionaire (1E/OB) "as though you were your opponent" cost model; `revealCards` groups by owner, not holder | `deferred/billionaire-and-reveal-holder.md` | **done.** `canUseOpponentAbilities` gains `"asOpponent"` (every cost paid by the opponent) for 1E/OB; 2E keeps `true` (borrower pays the numeric cost). Borrowed-ability listing now checks whoever actually pays. `cardsRevealed.ownerId` is now the zone holder (`heldBy ?? ownerId`). |

## Ground rules

1. **The card image is the authority** for what a printing says.
2. **Every printing plays exactly as printed on its own card** (user decision,
   2026-10-15, overriding CR 105.1's "most recent version"). A 1st Edition card
   that a 2nd Edition reprint reworded still plays as the 1st Edition card
   says. So `behavior` is per printing, and printings of one name may differ.
   Cards with the same name are still the same card for naming rules such as
   uniqueness and "named X" (CR 201.1b).
3. **`text` stays archival.** It is never edited. Where a printing's catalog
   text doesn't match that printing's card, the corrected text goes in
   `data/card-audit/corrections.json`, keyed by **printing id**, with the text
   and a reason. `markup` is regenerated from that, and the markup checks
   compare against the corrected text instead of `text`.
4. `wording` (same play, different words) needs no behavior change, but its
   display text still follows the printed words (see Decisions).
5. Stats (cost, threshold, strength/speed/life, structure, influence, type,
   subtypes) are gameplay fields, not archival. They are fixed directly in
   `cards.json` for each printing whose card disagrees.
6. **New per-printing fields:** `subtitle` (the line under the name, CR 201.1a)
   and `flavorText` (italic descriptive text, CR 201.5e). They can differ
   between printings, so each printing gets its own.
7. A typo is logged and corrected through `corrections.json` with the reason
   "typo", never silently.

## Phases

- [x] 0. Tooling and this doc. Batches are fixed in `data/card-audit/batches.json`
      (48 batches, ≤50 printings each, one set per batch).
- [x] 1. **Scan.** Sonnet sub-agents read every image and write one scan file
      per batch (`data/card-audit/scans/<batch>.json`). Instructions below.
- [x] 2. **Verify (sample).** A second reader re-read 5 cards from each of the
      48 batches (240 cards), and only one first-reader misread turned up (a
      dropped flavor word, now fixed). The flagged printings get their own
      look against the image during triage.
- [x] 3. **Triage (text + fields).** Printed-word corrections for 995 printings
      (`build-text`). Stat/name/type/subtype fixes were checked against the
      images and logged. Still open: reading the collector-number gaps in
      findings.md for printings missing from the catalog.
- [x] 4. **Fix behavior.** Markup is regenerated. All of `data/card-audit/behavior-worklist.md`
      is done except the manual-review card. Delegated engine items are tracked in the Deferred table.
- [x] 5. **Apply flavor.** `subtitle`/`flavorText` are on `CardDefinition` and
      applied to 2,100 printings. The manual-review card (Some Crazy Ornery
      Unfriendly Thug) still needs its fields by hand.
- [ ] 6. Close out: update the markup progress doc, RULES.md if rules changed,
      and memory.

### Known before the audit

- 4 Ungodly Mess cards carry the wrong version's text. The engine copied those
  errors: Wasted Wickedness, Corrosive Waste Dispenser, Headshot and Voidal
  Tactician (see `CARD-MARKUP-PROGRESS.md`).
- (FIXED by sub-agent 2026-10-16) 10 cards modeled "[icons]: …" threshold paragraphs (CR 201.5d) as free,
  repeatable activated abilities. They are Boorish Boar, Shrouded Demon, The
  Abominable Hamster, Protractive Golem, Runic Armor, Obtuse Pipesmoker,
  Fervent Beastslayer, Heavy Sword, Righteous Exemplar and Soulsearcher.
- 7 names have different `behavior` between printings, all involving an
  Ungodly Mess reprint: Quotidian Assassination, Pluck, Contriving Engineer,
  Zigalburgonglgr the Stolen God, Brainbath, Circumspect Hijacker and
  Overindulge.

## Progress

<!-- progress:start -->
**Scanned: 2101 / 2101 printings.** Regenerate with `npm run card-audit -- progress`.

| Set | Printings | Batches done | Scanned | Rules same | Wording | Different | Unreadable | Field diffs | Flavor text | Batches verified | Sample agrees |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| Open Beta | 206 | 5/5 | 206 | 60 | 114 | 32 | 0 | 5 | 120 | 5/5 | 25/25 |
| 1st Edition | 226 | 5/5 | 226 | 87 | 105 | 34 | 0 | 8 | 134 | 5/5 | 23/25 |
| 1st Edition Part 2 | 165 | 4/4 | 165 | 56 | 89 | 20 | 0 | 5 | 114 | 4/4 | 20/20 |
| Shade of the Devoured Emperor | 130 | 3/3 | 130 | 67 | 58 | 5 | 0 | 4 | 86 | 3/3 | 15/15 |
| Seed | 231 | 5/5 | 231 | 116 | 110 | 5 | 0 | 8 | 107 | 5/5 | 25/25 |
| Seed 2 | 110 | 3/3 | 110 | 37 | 68 | 5 | 0 | 3 | 31 | 3/3 | 15/15 |
| Seed 3 | 43 | 1/1 | 43 | 15 | 24 | 4 | 0 | 3 | 17 | 1/1 | 5/5 |
| 2nd Edition | 300 | 6/6 | 300 | 112 | 176 | 12 | 0 | 6 | 196 | 6/6 | 28/30 |
| Holy Heist | 165 | 4/4 | 165 | 152 | 10 | 2 | 1 | 0 | 100 | 4/4 | 20/20 |
| Ungodly Mess | 167 | 4/4 | 167 | 126 | 28 | 13 | 0 | 0 | 66 | 4/4 | 18/20 |
| Seed Saga | 358 | 8/8 | 358 | 337 | 20 | 1 | 0 | 9 | 194 | 8/8 | 40/40 |
<!-- progress:end -->

Full lists (generated) are in `data/card-audit/findings.md`.

## Scan instructions (phase 1)

You own one batch. Do not edit any file except your scan file. Do not run git.

1. `cd ~/dev/spoils-db && npm run card-audit -- manifest <batch>` lists your
   printings: id, image path, catalog fields and catalog text.
2. For **each** printing, open the image with the Read tool
   (`C:\Users\Andy\dev\spoils-db\data\assets\<id>.jpg`). Read the whole card,
   then write one record (schema below). Never fill a record from the catalog
   or from another printing. Every value comes from this image.
3. Save to `data/card-audit/scans/<batch>.json` (a JSON array of records) after
   every ~5 cards, rewriting the whole file each time. If one card can't be
   processed for any reason, give it a record with `rulesMatch: "unreadable"`
   and `notes: "SKIPPED: <reason>"`, then carry on.
4. When all records are written, run `npm run card-audit -- check --batch <batch>`.
   Fix every `ERROR`. For every printing it lists (field differences or
   `different`), open the image again and confirm your reading before you
   finish.
5. Reply with: counts per `rulesMatch`, and one line per `different` /
   `unreadable` printing. Nothing else.

### Scan record

Every field must be present. Use `null` for anything not printed on the card.

| Field | What to write |
|---|---|
| `id` | The printing id from the manifest. |
| `name` | Card name as printed. |
| `subtitle` | The small line just under the name, e.g. `to the air!`. |
| `cost` | The number in the top-left corner. `null` if none (resources, factions). |
| `threshold` | One lowercase letter per threshold icon under the cost: `o` obsession (arcanist), `g` greed (banker), `e` elitism (gearsmith), `d` deception (rogue), `r` rage (warlord), `v` volition. `""` if none. A card's icons almost always belong to its own trade. If one doesn't, say so in `notes`. |
| `strength` / `speed` / `life` | Character stats (STR / SPD / LIFE). On items, the signed modifier badges (`+2` → `2`, `-2` → `-2`). |
| `structure` | Location STRUCTURE. |
| `influence` | A faction's printed starting influence. |
| `typeLine` | The bar under the art, as printed, e.g. `ARCANIST CHARACTER – lurker`. |
| `rules` | The rules text, transcribed exactly. Put ` -- ` between paragraphs and between the lines that divider rules separate, and write icons as `[O]` `[G]` `[E]` `[D]` `[R]` `[V]`. Keep printed labels as printed (`COST – …`, `FLIP UP – 2 [G]`). Join wrapped lines with a space. Italic *reminder* text (usually in parentheses, explaining a rule) belongs here, with its parentheses. `""` if the card has no rules text. |
| `flavor` | Italic *descriptive* text about the card's world or story, not about rules. Join wrapped lines with a space. Use `\n` only between separate paragraphs or before an attribution line (`— Name`). Use straight quotes `"` `'`, `—` for long dashes and `...` for ellipses. |
| `artist` | The artist credit printed in the footer (`Art: Hans Janssen` → `Hans Janssen`). A signature inside the artwork doesn't count. |
| `rarity` | The printed rarity word, lowercase (`common`, `uncommon`, `rare`, `ultra rare`, …). |
| `collector` | The collector number as printed, e.g. `034/150`. |
| `copyright` | The copyright line, e.g. `© 2015 Arcane Tinmen`. |
| `printing` | Any special marking: `ARTIST SERIES`, promo stamp, alternate art, foil, prerelease, etc. |
| `rulesMatch` | Compare your `rules` with the catalog text (see below). |
| `notes` | Free text. Required for `different` and `unreadable`. Also note catalog typos, partly unreadable fields, and anything odd. If the image shows a different card entirely, write `IMAGE SHOWS <name>`. Otherwise `""`. |

### `rulesMatch`

- `same`: the same words as the catalog text. Ignore separators (` -- ` vs
  line breaks), `COST –` vs `COST:`, capitalization, quote/dash styles and
  trivial punctuation.
- `wording`: the words differ but the card plays exactly the same. That covers
  updated templating (the catalog says `EXTRA COST:` where the card prints
  `COST –`, or "each opponent" where it prints "your opponent"), a catalog typo
  (note it), or sentences in a different order.
- `different`: anything that could change how the card plays. That includes a
  missing or extra sentence, ability, keyword or FLIP UP, or a different number,
  icon, cost, target, timing, duration or "may"/"must". It also covers rules
  text on the card but none in the catalog, or the reverse. **When unsure, use
  `different`** and explain in `notes`.
- `unreadable`: you can't read the rules text reliably. Say which part.

## Verified problems

Each problem is written here as soon as it has been confirmed against the card image a second time, either by me or by a verify pass. Scanner findings that haven't been verified yet are in `data/card-audit/findings.md`, which every `check` regenerates.

| Card | Printing | Problem | Verified by |
|---|---|---|---|
| Malevolent Trooper | Ungodly Mess | Threshold prints [R][R]; catalog had `rrr`. **Fixed.** | image re-read (lead) |
| Unwise Encirclement | Ungodly Mess | Prints WARLORD TACTIC; catalog type was `character`. **Fixed:** type is now tactic, and the behavior moved from `onPlay` to the tactic ability shape. | image re-read (lead) |
| Wasted Wickedness | Ungodly Mess | Wrong-version text: card has FLIP UP – 1 [O] and different wording. | image re-read (lead, markup session) |
| Corrosive Waste Dispenser | Ungodly Mess | CONVERT cost prints "Pay 1."; catalog omits it. | image re-read (lead, markup session) |
| Headshot | Ungodly Mess | Wrong-version text (card: "…Repeat this effect up to three more times."). | image re-read (lead, markup session) |
| Voidal Tactician | Ungodly Mess | Wrong-version text (card: depleted trigger, "that faction's controller's deck"). | image re-read (lead, markup session) |
| Stalwart Soldier | Open Beta | Prints SPD 3; catalog had 4. **Fixed.** | image re-read (lead) |
| Micromajig Shipping Container | 1st Edition Part 2 | Prints subtype "container"; catalog had "machine". **Fixed.** | image re-read (lead) |
| Pettifogger | 1st Edition | Prints "lawyer, mau"; catalog had only "lawyer". **Fixed.** | image re-read (lead) |

## Image problems

These are printings whose image file shows the wrong printing or the wrong card. The art for that printing is missing, so flavor/subtitle copied from such an image belongs to another printing.

| Card | Printing | Problem | Found by |
|---|---|---|---|
| Voidal Replication | Open Beta `b9e94612-3cbd-44ff-9aac-a553a49c0955` | The image is the 1st Edition printing (043/220, no BETA ART stamp). | scanner open-beta-01 |
| Catastrophic Betrayal | 2nd Edition (188/300) | Looks like a proof scan too: no copyright line, no set logo. Rules unaffected. | missing-printings agent |
| Holy Heist Deception | 2 of its 3 printings | Byte-identical image files; one art variant is probably missing. | missing-printings agent |
| Sudden Osprey | 2nd Edition `0ca8f5d5-6473-4bfc-bf16-f38d8e2b83a0` | Looks like a pre-release proof: no threshold icons, no copyright line. The catalog threshold `dd` is kept. | image re-read (lead) |

## Manual review

When the API content filter cuts a scanner off (some card art has nudity), the card it was on gets a placeholder record. That record has `rulesMatch: "unreadable"` and notes starting `MANUAL REVIEW: content filter`, and the batch resumes at the next card. These cards show up under "Unreadable" in `findings.md` and need a human look at the image.

| Card | Printing id | Batch | Status |
|---|---|---|---|
| Some Crazy Ornery Unfriendly Thug | `49ba7019-9706-4ea4-b958-630a4400ef8c` | holy-heist-04 #33 | needs human look |

## Verify instructions (phase 2)

A second reader independently re-reads 5 hash-picked printings from each
finished batch and must not open `data/card-audit/scans/` or `findings.md`.
The reader runs `npm run card-audit -- sample <batch>`, writes
`data/card-audit/verify/<batch>.json` in the same record format, then runs
`npm run card-audit -- check --verify <batch>`. Disagreements go to
`findings.md` ("Verification disagreements"), and I settle each one against
the image. If a batch's first reader got real content wrong (rules, stats,
flavor words), the whole batch is re-scanned.

### Verify adjudications

- Overly Eager Exemplar (HH): the first read dropped "and" from the flavor text. I fixed it from the image.
- Seriously Weird Crystalline Artefact (HH): the card prints UNIQUE IGNATIUS and the catalog has IGNATIOUS. The first reader was right and the verifier was wrong.
- Micromajig (UM) collector "1 of 3" and Zenobia, Artificer "3 0f 6" are formatting conventions only, so no change.
- Explosive Fury (2E) flavor: in this low-res image "Warning" can't be told apart from "Waming" ("rn" vs "m"). Keeping "Warning".
- Hidden Sandwich (2E): the readers disagree on whether this is `different` or `wording`. That's a classification question, so it gets decided at triage.
- 2nd Edition + Seed 3 sample: 35 cards, with no first-reader misreads.
- Seed 2 + Seed sample: 40 cards. 1st Edition + Open Beta samples: 50 cards. Neither had first-reader misreads. The leftover disagreements are classification calls (Makeshift Contrivance, Shocking Reappearance, Underhanded Gamer), and those go to triage. Shocking Reappearance (Open Beta) was switched to `different`.

## Decisions

- Phase 4 test plumbing: `printedRules()`/`samePrintedRules()` in `per-card/_harness.ts`. The reprint-parity checks (1st Edition, 2nd Edition) now require equal behavior only between printings with the same printed rules. Seed Saga's PARITY list drops names that diverge. Every divergence is tested in `per-card/printed-variants.test.ts`.
- Phase 4 G1 (part): Blow Up (1E2, 2E), Caboodling Gladhander (Seed), Irresistible Bribe (OB, 1E, 2E) and Ritual of the Knob & Pull (1E2, 2E) now use "your opponent" as printed. Redonkulous Seed 2 was already right. **Redonkulous Seed Saga** prints "that character's controller", so it now uses the picked character's controller.
- Phase 4 G1 (rest): Splattergun (1E2, 2E) gives control to your opponent. Needless Beating (1E2, 2E), Mass Confusion (Seed) and Smothering Corpulence (Seed 2) now let you pick any character. Surprise! (Seed + Seed Saga) only picks an attacking opponent character; the old selector also accepted any location. Scrag was already right. Underhanded Gamer is the same in 2-player.
- (Superseded) The "your hand / your deck" engine limit was resolved by a sub-agent (see `deferred/your-hand-zones.md`).
- Seed Saga reprint parity is printed-text aware too. Its PARITY list is now only checked to be reprints.
- G9 Brainbath: the Ungodly Mess printing made two mandatory steps optional. It now shares the Seed Saga behavior.
- Phase 4 G2 (durations): new engine flag `persistent` on the `preventDamage` and `reduceThreshold` effects. A persistent shield or reduction survives the start-of-turn sweep until it's used. A Series of Tubes (1E) REDIRECT and Clockman Skydocks (Shade) use it. Befuddling Beggar (OB), Strength In Numbers (OB) and Fleshripping Scenepuller (1E2) have permanent modifiers, since those printings say no "this turn". Full suite: 4865/4865.
- Phase 4 G3 ("only member of an attacking party"): the condition is `inBattle(source, attacker)` plus `battlePartySize(ownParty) = 1`. Clockman Pickpocket (1E2), Cute Cutpurse (1E2), Face in the Crowd (1E) and Thundering Nilpha (1E2) use it. New engine field `grantKeyword.condition` (a keyword that only counts while the condition holds) makes Schproingmajig (1E2) SCHPROING! work. Clockman Pickpocket and Cute Cutpurse's item pick ("must pick" / "if they can") is now mandatory in every printing; before, it could be declined. Three old 1E/1E2 tests now attack alone, as their printings require.
- Phase 4 G4 (Micromajig tokens): 9 printings (Avalanche/Factory/Maker/Master in OB+1E, Shipping Container in 1E2) whose reminder text defines the token with no subtype now make tokens with no subtype. Cards that only say "put a Micromajig token into play" correctly keep "majig", because the Micromajig token card (HH/UM) prints "GEARSMITH CHARACTER – majig".
- Phase 4 G5 (reveal / "up to" / "either deck"): no behavior changes needed, decided per card in the worklist. A reveal on a card that goes into play or to the discard pile is moot. "Either deck" is the same as "any one deck" in 2-player. Behavior already looked at or revealed *exactly* the top N, as the old printings say, and the newer "up to" never allows a better outcome. "Costs up to N less" is the same as "by N", because reducing by less never helps. Contriving Engineer's three printings now share one behavior (G9).
- **Follow-up (engine-wide):** search reveals aren't modeled. 82 catalog cards say "search … and reveal it" and none emit `cardsRevealed`. That matters for a renderer or log showing the opponent what was fetched, not for game outcomes.
- **Engine fact (matters for every fix):** `CardSelector.controller` / `owner` ("self"/"opponent") are relative to the *effect's controller*, never to a `chooserSelectsTarget` chooser. The Redonkulous (Seed Saga) FLIP UP discard was corrected for this: the picked character's controller discards from their own hand (tested).
- Phase 4 G6: Wasted Wickedness (UM) is rebuilt from its printing. It's modal (pick your opponent / pick yourself), X counts that player's staple types, the return is mandatory, and it has FLIP UP 1 [O].
- Phase 4 G6: Corrosive Waste Dispenser CONVERT now costs Pay 1, and the sacrifice is picked by the player (it was random). "Each opponent destroys a character" no longer also makes you destroy one; `forEachPlayer` covers every player. Voidal Tactician's second paragraph is now the printed one-shot "when this card is depleted" void-tactic deploy. Headshot was already right. All are tested.
- Phase 4 G6: Feckless Chronicler got FLIP UP 2 [D]. Efficacious Gunslinger now triggers on any damage. Cicibeo's IMPLY now takes control only if the revealed card is a character (all printings; it was a free choice). **New engine feature: last-known stats.** A `stat` expression on the event card after it left play reads what the card had when it left (Gosche's Restoration Fortress "had"). Lockbox of the Aeons and Cunning Ruse were already right.
- Phase 4 G6 done. Elitist Upgrade (HH) FLIP IT is now Pay 5, usable during a battle, and pumps all Micromajigs. Mistaken Identity (Seed Saga, "as a cost") now also answers abilities; Seed 2 ("as an extra cost") stays cards-only. Printed misprints kept as the only workable reading: Frantic Jerryrigging's undefined X is the destroyed item's cost, and Seriously Weird Crystalline Artefact's "IGNATIUS" is the IGNATIOUS unique.
- Phase 4 G7 (part 1):
  - 4p7 31f (1E2) also triggers when a gear is attached later (`cardAttached`).
  - Ecto-Distillation: Open Beta pulls every copy and you must take one. 1E and 2E let you search "any number", and the opponent may pull the rest.
  - Flaming Cube makes only your opponents lose 6; `forEachPlayer` + "opponent" was hitting both factions, and a catalog-wide scan found no other case.
  - Giada (Seed 3) no longer resets damage, since her printing doesn't say to.
  - No change needed: Beatrix, Counter Attack, Barracks of Precipitancy and Flailing Knife.
  - Emergency Obfuscation's seat swap was never modeled in any printing, so it went to a sub-agent.
- Phase 4 G7 (part 2): Hypnotic Plafond (1E, OB) now *prevents* COVERT parties from attacking your faction, using the new `preventsAttackOnFaction.partyAllMatch`; before, it zeroed their damage. I Drink Your Milkshake (Seed 2) removes the card from the game instead of voiding it. **Engine fix:** an engine-offered from-zone deploy of a card you don't own now puts it under your control. Milkshake's echo had never worked in any printing ("You cannot deploy that card"). `cardAttached` was added to the integrity test's event list.
- Phase 4 G7 (part 3): Jumping Screamspider's SCREAM is now a this-turn aura on the opposing battle party, stacking per use. Before, it was a snapshot of the current battle and did nothing when used before combat, in all printings. Open Beta adds once each turn. Kettinger (OB) gives +3 strength as printed.
- **Catalog-wide bug fixed:** "If this card would be/is destroyed … instead" replacements weren't bound to their own card, so they fired for *any* destroyed card. A probe showed Fired Hand flipping the opponent's destroyed character face-down. 15 printings were bound to themselves (Unloyal Necromorph, Node in a Box, Ocular Dispersal, Ceremonious Groomer, Fired Hand, Lucky Bastard, Rusty Pickaxe, Surplus Soldier, Vorpal Sword), plus Giada. A guard test now catches this.
- Lugubrious Node (1E, OB) got its missing "cannot be destroyed by other node cards" protection, using new engine field `replaces.bySource`. The engine now tracks the destroying effect's source card (`currentCauseSourceId`). Limited Liability needs no change (CR 408.1).
- Phase 4 G7 (part 4): Martial Arts Master (1E2) gains strength unblocked, since its printing has no opposing-character condition. Makeshift Contrivance (1E) puts a resource into play rather than playing one, using new `playResource.putIntoPlay`, so "when you play a resource" triggers don't fire. Quipmajig is equivalent (CR 408.1).
- Phase 4 G7 (part 5): new engine flag `CardInstance.deployedAsResponse` with a matching condition. Ravenous Wolf (1E, OB) and Unexpected Boobysnake (1E2, 2E) print "You may play this card whenever you could play a tactic. If you do, …", so their drawback now applies whenever they were played into a response window. Before, it only applied on the opponent's turn. Raging Bask is equivalent.
- Phase 4 G7 (part 6):
  - Research Investment (OB) searches up to 5.
  - Sarcophyle Matriculation: 1E replaces the destruction and depletes the card; OB destroys it, then returns it depleted.
  - Scavengemajig (OB) puts the item into play.
  - Study Disturbance looks at your top card, and Tedious TriAdic Truculence needs 3 different names. Both now have **fidelity full**: their "partial" concession, a buyout on resolution, is exactly what the Shade printing says. Fidelity counts are now 2098 full / 1 partial / 2 stub.
  - Subversion Matrix (1E) enters unattached.
  - No change needed: Samuel Gristwalter, Skin Suit, Spiky Atlasphere and Tactician Vacation.
- Phase 4 G7 (part 7, last G7 batch):
  - Shocking Reappearance (1E, OB) now needs you to already be blocking.
  - The Emperor Barduse (Seed 2) counts dragon cards of any type.
  - Tri-Pole Magnet (1E, OB) checks the host is still in play.
  - Vander Malagut (OB) lets the character be destroyed, then returns it.
  - Society of Magical Propriety and the Ministry are already right.
  - The Billionaire (1E, OB) went to a sub-agent because its cost model differs.
- Field fixes taken from the scans: Tri-Pole Magnet (OB) subtype gear, Lugubrious Node (OB) subtype node, Lugubrious Node (1E) no subtype, Gambling Den (Seed Saga) rarity uncommon, and Seed 3 faction rarities (epic / e-sle / promo) as printed.
- Names corrected to the printed spelling. Every printing of each name agrees: Yenessa → **Yenassa** Shipping, LLP; Abram Ka-darbo Alkazin → **Alakazin**; Duskfall Buckgriff → **Buckgrif**. Tests, reviewed.json and docs were updated. The behavior `unique` key `buckgriff` is internal and stays. spoils-game's `docs/story-mode-campaign.md` still says "Alkazin", because that's outside this repo.
- Not reproduced, because they are printing errors in subtypes: Sneaking Spitspider (1E) "subtypes" placeholder, Guardforce Alpha Prime H4x0r (2E) "guardforcee", Undead Sword (Seed Saga) "nercomorph", Athalamund (Seed Saga) truncated "sword of great". The Deranger's ™ and Mau "Consultant"'s quote style are not part of the name. Seed 3 faction influence formulas/blank influence are kept as catalog numbers (the engine needs a number).
- 2026-10-15 (user): every printing plays as printed on its own card. "Newest printing wins" is dropped.
- 2026-10-15 (user): no full second read of flavor/subtitle. The sample misread rate (1/240) is acceptable.
- 2026-10-15 (user): the displayed text uses each printing's **exact printed words**. Every printing whose card words differ from `text` (`wording` or `different`) gets a `corrections.json` entry built from its transcription, and its markup is regenerated from that. Label punctuation (`COST –` vs `COST:`) is rendering, not words, so corrected text uses the catalog's label format.

## Session log

- 2026-10-15: phase 0. Tooling, batches, and this doc.
- 2026-10-16: phase 4 started, solo (the user briefly asked for sub-agents, then took it back). Progress is ticked in `data/card-audit/behavior-worklist.md`, and decisions are logged here.
- 2026-10-15: printed wording applied. `npm run card-audit -- build-text` wrote 995 per-printing corrections from the scans and regenerated their markup, with 0 errors. Every flag left in `data/card-audit/markup-review.md` is benign: nameless COST/EFFECT on old tactics, printed caps, option bodies checked by eye. Markup overrides can now be keyed by printing id (Obscene Astrologer, Seed 2). Full suite: 4842/4842.
- 2026-10-15: phases 1–2 done. 2,101 printings scanned, with flavor/subtitle applied to 2,100 (1 manual review). Verify sample: 240 cards, 1 misread.
- 2026-10-15: phase 1 started with at most 5 scanners at a time. The pilot (ungodly-mess-04) caught both known bad cards there. The first holy-heist-04 scanner was cut off by an API content filter after 20 records. A resume scanner finished the batch, saving after every card. Up to 8 scanners at a time from here. `subtitle` / `flavorText` were added to `CardDefinition`, and `apply-flavor` now runs after each finished batch.
