# Missing and suspicious printings

Analysis of `data/cards.json` (2,101 printings, 11 sets) against the scans, `findings.md` "Collector numbers", `image-problems.json`, and the two raw databases. Written 2026-10-15. Read-only analysis: nothing in the catalog was edited.

How to read this:
- **Confidence** is stated per finding (high / medium / low). "Gap" means a hole in a printed collector-number run. "Series" means an unnumbered group (staples, factions, tokens, ultra rares).
- Opened images (9 of the 20 budget): the 3 Ungodly Mess Micromajig tokens, Holy Heist Obsessive Concentration, 1st Edition Obsession / Greed / Rage, Seed Obsession, Open Beta Obsession. Everything else comes from the scans and catalog.
- External facts come from Wikipedia ("The Spoils (card game)") and ICv2 articles 34048, 34178, 31805, 34668 (see the end).

## Headline

1. **Numbered runs have no real gaps.** The three "missing numbers" in findings.md are all explained by cards that already exist in the catalog (Open Beta 038, Holy Heist 013 and 134). No numbered printing is missing from any set.
2. **The real holes are in the unnumbered series and in sets not in the catalog:**
   - A whole set, **Decade of Deckadence** (Aug 2016, 428 cards, 156 all-new), is not in the catalog at all.
   - **Seed 3** lists 25 additional cards (multiplayer factions and full-art resources); the catalog has 13.
   - **Ungodly Mess** "Epoch Edition" ultra rares have no Warlord card (every other trade has exactly 2).
   - **Holy Heist** has 3 art variants for each of the 5 staples, but two Deception entries are byte-identical files, so one variant's art is missing.
   - The 5 staples filed under **1st Edition** are (c) 2007 with a "1st Edition Part 2" badge, so they look like Part 2 staples; the real (c) 2006 1st Edition staples may be missing.
3. **Wrong image:** Open Beta Voidal Replication shows the 1st Edition printing (byte-identical file). This is the only confirmed wrong-set image.

## Size and coverage per set

| Set | Printed size | Catalog printings | Numbered | Other (unnumbered) | Gaps |
|---|--:|--:|--:|--:|---|
| Open Beta | 200 | 206 | 200 (see 038 note) | 5 staples + Tournament Faction | none (038 = Voidal Replication, wrong image) |
| 1st Edition | 220 | 226 | 220 | 5 staples + Tournament Faction | none |
| 1st Edition Part 2 | 165 | 165 | 165 | 0 | none |
| Shade of the Devoured Emperor | 130 | 130 | 130 | 0 | none |
| Seed | 220 | 231 | 220 | 5 staples + 6 factions | none |
| Seed 2 | 110 | 110 | 110 | 0 | none |
| Seed 3 | 30 (+25 additional per Wikipedia) | 43 | 30 | 5 full-art resources + 8 factions | 12 of the 25 additional may be missing |
| 2nd Edition | 300 | 300 | 300 | 0 | none |
| Holy Heist | 140 | 165 | 140 (139 scanned + Thug unscanned) | 6 tokens (01/06-06/06), 15 staples (5 x 3 art variants), 4 factions | 013 and 134 both have catalog cards; 1 staple variant has no art of its own |
| Ungodly Mess | 150 (140 + 10 uber) | 167 | 150 | 6 super rare, 8 ultra rare (Epoch), 3 tokens | probably 2 Warlord Epoch ultra rares; token series unclear |
| Seed Saga | 350 | 358 | 350 | 8 factions | none |

Rarity splits of the numbered runs all hit round numbers, which supports "no gaps": Open Beta 90/67/43 C/U/R (=200), 1st Edition 110/55/55, 1st Edition Part 2 55/55/55, 2nd Edition 100/100/100, Seed 80/70/70, Seed 2 60 C/50 R, Shade 50/40/40, Holy Heist 50/50/40 (counting the Thug as uncommon), Ungodly Mess 56/44/40 + 10 uber (ICv2 confirms exactly this), Seed Saga 101/149/100. Cross-set name overlap also closes: Open Beta's 200 names are all in 1st Edition; 2nd Edition = 166 names from 1st Edition + 134 from Part 2 = 300 exactly; Seed Saga = 214 Seed reprints + 96 Seed 2 reprints + 40 new numbered cards (ICv2: 41 new) = 350.

## Per set

### Open Beta (200)

- **Gap 038/200 = Voidal Replication** (arcanist tactic, uncommon). Order is Voidal Poisoning 037, **038**, Voidal Webbing 039. The catalog already has Voidal Replication (id `b9e94612-3cbd-44ff-9aac-a553a49c0955`), but its image is byte-identical to the 1st Edition printing's image (043/220), so the scan read "043/220" and findings.md reports a phantom 201-220 range ("size printed 200, 220"; missing 38, 201-220). The 201-220 "missing" numbers are an artefact of that one scan. **Fix:** the entry is right, the image is wrong. It needs the real BETA ART image, collector number 038/200. Confidence: high.
- **Shared number 43:** Beatrix Winterbottom 043/200 (correct) vs Voidal Replication (the wrong image above). Not a real duplicate.
- Unnumbered: 5 staples + Tournament Faction, all (c) 2006 with BETA marks. Fine.
- Every other Open Beta printing carries a BETA ART marking or BETA mark in its scan.

### 1st Edition (220)

- Numbered 001-220: complete, no shared numbers. Voidal Replication here is 043/220 and is the real 1st Edition card.
- **Staples look misfiled (medium confidence).** The 5 staples (Obsession, Greed, Elitism, Deception, Rage) are (c) **2007** and show a "1st Edition Part 2" badge (scans for Obsession and Deception say so; I opened Obsession, Greed and Rage and all three have the same small badge and (c) 2007). Every other 1st Edition card, and the 1st Edition Tournament Faction, is (c) 2006. The Open Beta staples use the same layout in 2006 with a BETA label. So:
  - these 5 printings probably belong to **1st Edition Part 2** (which has no staples or factions in the catalog), and
  - the real 1st Edition staples ((c) 2006, plain 1st Edition badge) are probably **missing: 5 printings** (Obsession, Greed, Elitism, Deception, Rage).
  - Check: is there a second set of staple images in the source, or do the originals show a different badge? If the user only wants to keep what the source has, re-file the 5 to Part 2.
- Tournament Faction: present ((c) 2006). Fine.
- 20 cards are ARTIST SERIES but each occupies its own number, so these are the only version of that slot. Not duplicates.

### 1st Edition Part 2 (165)

- Numbered 001-165: complete, no shared numbers, rarity 55/55/55.
- No staples or factions in the catalog (see 1st Edition note: the 5 staples filed under 1st Edition probably belong here).
- 33 ARTIST SERIES cards, each in its own slot. Same art as the matching 2nd Edition artist-series printings (e.g. Horsemajig of the Apocalypse x4), which is expected.

### Shade of the Devoured Emperor (130)

- Complete, no shared numbers, 50/40/40. No staples or factions in the catalog. Nothing suspicious.

### Seed (220)

- Numbered 001-220: complete. Unnumbered: 5 staples + 6 factions (Alliance of Handy Weirdos, Drowned Catacombs, Hall of Great Justice, Moist Cave of the Darkpump, Order of the Golden String, The Tournament Faction), all (c) 2007. Complete (the 6 factions all reappear in Seed Saga).
- 17+ ARTIST SERIES in their own slots. Not duplicates.
- Seed Obsession (opened) has real art (a purple-haired figure), so Seed staples are not the same cards as the 1st Edition staples.

### Seed 2 (110)

- Complete (60 C / 50 R, no uncommons, which matches the set). Contrabulous Fabtraption (052/110) "no artwork" is an intentional joke card, not an image problem. The 5 Crest of X cards are 085-089.

### Seed 3 (30 + more)

- Numbered 001-030 ("fixed" rarity): complete.
- Unnumbered: 5 full-art resources (Obsession, Greed, Elitism, Deception, Rage; no footer at all) and 8 factions: Imperial Army, Counter-Imperial Army, The Evil Alliance, Slightly Less Evil Alliance (2 two-sided pairs), The Knitting Coalition, The Society of Magical Propriety, The Union of Unextraordinary Miners (rarity "epic"), The Open R&D Faction (promo). Total 13.
- **Wikipedia: "Seed III ... 30 + additional 25 cards (Multiplayer and full art resources)".** The catalog has 13, so up to **12 printings may be missing** (multiplayer factions and/or more full-art resource arts). I can't name them from the data. Confidence: low-medium (the count comes from one external source and the wording "additional 25" may include things outside the catalog, such as foil promos).
- Faction rarities (epic / e-sle / promo) are printed as such, so the "rarity mismatch" in raw-database variants for these is only the raw db's empty string.

### 2nd Edition (300)

- Complete, 60 per trade, 100/100/100. Shared numbers: none. About 45 "Limited edition artwork" (artist series) cards each occupy their own slot.
- **Suspicious images:** Catastrophic Betrayal 188/300 (`a2c972fc-f5de-4976-a2c6-a0518fa1a0e4`) and Sudden Osprey 231/300 (`0ca8f5d5-6473-4bfc-bf16-f38d8e2b83a0`) both show no copyright line and no 2nd Edition logo, and Sudden Osprey has no threshold icons. Both credit "Patrick Meehan & TGA". They look like proofs or pre-release images. Only Sudden Osprey is in the audit's image-problem table; add Catastrophic Betrayal. The collector slots are right, so nothing is missing; the art for the final printing may differ.
- No staples or factions (see "other sets" note below).

### Holy Heist (140)

- **Gap 013 = Obsessive Concentration** (arcanist resource, uncommon). Order is Night-basking Basilisk 012, **013**, Offering of False Friendship 014. The card is in the catalog and its image (opened) prints "043/140", the same number as Greedy Profiteering (banker resource, correct at 043 between Gargoyle of Cathedrale de Mau and iDumb De-Itemizer). So 043 is a **printing error on the card** (it should read 013). The scanner read it right; there is no missing card. Do not "fix" the number silently; record it as a misprint (confidence: high).
- **Gap 134 = Some Crazy Ornery Unfriendly Thug** (warlord character, uncommon). Order is Skilled Bannerman 133, **134**, Special Forces 135. It is in the catalog but was never scanned (content filter), so its collector number is null. Confidence: high. Needs the manual look already tracked in CARD-AUDIT-PROGRESS.md.
- **Shared numbers 1-6** in findings.md (Additional Tribute/Micromajig and so on) are a parsing artefact: the tokens print "01/06"-"06/06" and were compared to 001-006/140. The 6-token series is complete.
- **Staples: 15 printings (5 staples x 3 art variants A/B/C) are intended, not duplicates.** Obsession, Greed, Elitism and Rage each have 3 distinct images. **Deception has only 2 distinct images:** `2d2e52f6-9aee-45e2-9e89-703ebdd3b413` and `c1102831-2b01-4018-9d48-0b096e466653` are byte-identical (md5 equal; the scanner noticed too). The "large faded icon" variant (`a38ef747-...`) is the third. So one Deception variant (the second splatter variant, by analogy with Rage B / Greed B) has no art of its own in the catalog: **1 printing needs real art** (the entry exists, the image is a duplicate). Confidence: high that one image is wrong, medium that it is variant B.
- 4 factions: Lugubrian Council Expedition Division, The Primitive Tribes of Thabbash, The Tournament Faction, Unlikely Heroes. Complete as far as the data shows.

### Ungodly Mess (140 + 10 uber)

- Numbered 001-150: complete. All five super-rare "alt" versions (Lockbox of the Aeons 012, Yenassa Shipping 058, Zenobia Artificer 086, Abram Ka-darbo Alakazin 088, Single Combat 145) coexist with a normal numbered printing of the same name. That is the intended "alternate full-art" pairing, not a duplicate.
- **Super rare "N of 6": complete (1-6)**, one per trade plus Universal: Lockbox (1), Yenassa (2), Zenobia (3), Abram (4), Single Combat (5), Zigalburgonglgr (6). Footers misprint "0f" for "of" on 1, 3, 4, 5, 6. Zigalburgonglgr's super rare shares its name with Holy Heist 113/140.
- **Epoch Edition ultra rares (8 in the catalog): probably 2 missing.** The catalog has: Arcanist: Brainbath, Quotidian Assassination; Banker: Circumspect Hijacker, Limited Liability; Gearsmith: Contriving Engineer, Multi-Attachment Man; Rogue: Overindulge, Pluck; **Warlord: none.** Every trade has exactly 2 uber rares in the numbered set and every trade except Warlord has 2 ultra rares. All 8 are reprints of earlier cards (Open Beta/1st Edition: Quotidian Assassination, Limited Liability, Pluck; Seed: Brainbath, Circumspect Hijacker, Multi-Attachment Man, Overindulge; 1st Edition Part 2: Contriving Engineer). So **2 Warlord Epoch Edition ultra rares** are likely missing; I can't name them from the data. Confidence: medium. None of these carries a collector number, so there is no numbering to confirm the total.
- **Micromajig tokens (3 in the catalog): series unclear.** I opened all three: they show different art by different artists but print "TOKEN 1 of 3" (Yaseri Stoilov, couch with red bow), "TOKEN 1 of 2" (Robert Knight, confetti parade) and "TOKEN 1 of 3" (Mara Miranda, mirror with top hat). Two cards cannot both be 1 of 3, and 1 of 2 implies a 2nd card. Either the cards were misprinted or the series has more members: possibly 2 of 3, 3 of 3, 2 of 2. Holy Heist's tokens use the same three artists, 2 each (6 cards), so a 6-card Ungodly Mess set is also plausible. ICv2 says Ungodly Mess adds "full-art foil tokens". **0 to 3 printings may be missing.** Confidence: low.
- Findings.md collector "3 0f 6" and "1 of 3" strings are formatting quirks.

### Seed Saga (350)

- Numbered 001-350: complete. 8 factions: Alliance of Handy Weirdos, Defenders of Marduun, Drowned Catacombs, Hall of Great Justice, Moist Cave of the Darkpump, Order of the Golden String, The Tournament Faction, Legions of Chaos. This matches the 8 in "x/8".
- **Shared number 5:** Confounding Conjurer 005/350 and Legions of Chaos "STAPLE 5/8". Different series (a faction numbered x/8). Not a duplicate. Only Legions of Chaos has its number scanned; the other 7 factions print no number or it wasn't read.
- ICv2: 350 cards, 41 new, 49 with alternate art. Catalog: 40 new numbered cards + 2 new factions (Defenders of Marduun, Legions of Chaos). Matches.
- No Seed 3 card names appear in Seed Saga even though Wikipedia says Seed Saga combines Seed I-III. Not a gap in the numbering, only a data point.

## Duplicates and shared names (all cases)

| Case | Verdict |
|---|---|
| Open Beta 043 (Beatrix Winterbottom / Voidal Replication) | Voidal Replication has the wrong image; real number 038/200 |
| Holy Heist 043 (Greedy Profiteering / Obsessive Concentration) | Misprint on the card; real slot 013 |
| Holy Heist 1-6 vs token 01/06-06/06 | Different series; tool artefact |
| Seed Saga 5 (Confounding Conjurer / Legions of Chaos 5/8) | Different series |
| Holy Heist staples 3 each | Intended art variants; Deception has 2 identical images |
| Holy Heist Micromajig x6, Ungodly Mess Micromajig x3 | Different tokens |
| Ungodly Mess 5 super-rare pairs (Lockbox, Yenassa, Zenobia, Abram, Single Combat) | Intended alt full-art versions of numbered cards |
| Voidal Replication image identical in Open Beta and 1st Edition | Wrong image on Open Beta |
| Deception (Holy Heist) image identical x2 | Duplicate file, a variant's art is missing |

No other pair of image files in the 2,101 is byte-identical, and no card shares a name and a set with another printing except those listed.

## Staples, factions and promos

- Staple sets present: Open Beta (5), 1st Edition (5, probably Part 2 stock), Seed (5), Seed 3 (5), Holy Heist (15). Factions: Open Beta 1, 1st Edition 1, Seed 6, Seed 3 8, Holy Heist 4, Seed Saga 8.
- **No staples or factions at all** in 1st Edition Part 2, Shade, Seed 2, 2nd Edition, Ungodly Mess. This may simply be how those products shipped (basic resources were reused), so it is only a hint. I would not add anything without evidence.
- Promos: Wikipedia says foil versions of faction cards were given away at Gen Con, and Seed 3 has "The Open R&D Faction" (promo). Gen Con 2013 champion cards (Ecneret, Arrogance) are in Seed Saga as numbered cards. No separate promo set is in the catalog; I can't say which promos exist.

## Whole set missing: Decade of Deckadence

Not in the catalog. External sources (ICv2 article 34668 and web search results, plus the Wikipedia table not listing it) say: released August 2016 as a new core set / cube, **428 cards, 156 of them new**, announced alongside Ungodly Mess, legal in tournaments. If the user's source has it, that is about **428 printings**: roughly 272 new printings of existing names and 156 new names. Nothing in this repo (cards, scans, assets, raw databases) mentions it, so there is no art or numbering to work from here. Confidence that the set exists: high. Confidence that the user's source has art for it: unknown.

## Recommended additions and fixes

Ordered by confidence and effort.

1. **Open Beta Voidal Replication (`b9e94612-...`)**: replace the image with the real BETA ART card; set collector number 038/200. (Confirmed wrong; already in image-problems.json.)
2. **Holy Heist Deception variant B**: `2d2e52f6-...` and `c1102831-...` share one file. Provide the missing third art (the other splatter variant) for one of them. Optionally describe variants A/B/C in `printing` as the other staples do.
3. **Holy Heist Obsessive Concentration**: keep as a printing with its misprinted 043/140; record the intended slot 013/140 in `notes`. **Some Crazy Ornery Unfriendly Thug**: human look to confirm 134/140 and finish its fields.
4. **1st Edition staples**: decide whether the 5 (c) 2007 "Part 2"-badged staples belong in 1st Edition Part 2 (re-file) and, if the source has them, add the 5 real (c) 2006 1st Edition staples. Needs a look at the original source listing.
5. **Ungodly Mess ultra rares**: add the 2 missing Warlord Epoch Edition ultra rares if the source has them (names unknown).
6. **Ungodly Mess Micromajig tokens**: check whether 2 of 3, 3 of 3 and 2 of 2 exist. Record the printed numbers as they are (two "1 of 3", one "1 of 2").
7. **Seed 3**: look for up to 12 more printings (the Wikipedia count is 25 additional vs 13 in the catalog): extra multiplayer factions and full-art resource variants.
8. **Decade of Deckadence**: new set of ~428 printings (156 all-new cards); needs a plan for the new names, since the catalog is keyed by card.
9. **2nd Edition proofs**: add Catastrophic Betrayal 188/300 to the image-problem list next to Sudden Osprey 231/300; replace both images if the final printing exists.
10. Fix the findings.md "Collector numbers" generator: ignore "0N/06" tokens, "N/8" faction numbers and printed misprints when listing "numbers on more than one printing" and "missing numbers"; otherwise it will keep reporting phantom gaps (Open Beta 201-220, Holy Heist 13/134).

## Sources

- Wikipedia, "The Spoils (card game)": set table (sizes, dates, Seed III "30 + additional 25 cards", Seed Saga "combined and reprinted... over forty new cards").
- ICv2 article 34048: Ungodly Mess 150 cards = 56 C / 44 U / 40 R / 10 uber.
- ICv2 article 34178: Ungodly Mess adds Super Rare, Ultra Rare, Uber Rare, full-art foil tokens, promos.
- ICv2 article 31805: Seed Saga 350 cards, 41 new, 49 with alternate art.
- ICv2 article 34668 and web search: Decade of Deckadence, 428 cards (156 new per search results), August 2016.
