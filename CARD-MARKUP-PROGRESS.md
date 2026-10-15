# CARD-MARKUP-PROGRESS.md

Tracker for converting every card's plain `text` into structured `markup`
(branch `card-text-markup`). Expect this to take several sessions. **Start
each session by reading this file**, then run `npm run card-markup -- progress`.

## Why

`CardDefinition.text` is one flat string with ` -- ` as a line separator.
Nothing in it says what a piece *is*, so a renderer can't tell an ability name
("MAKE VANISH") from a keyword ("COVERT") from a faction rule label ("STARTING
DRAW"), or show an ability's name next to its cost and effect. `markup` is the
same text wrapped in a small, closed set of semantic tags
(`src/cardText.ts`, exported as `spoils-db/card-text`), parsed into a typed
tree with `parseCardText`.

## Ground rules

1. **`text` is archival.** It is never edited or regenerated. Every markup
   must round-trip to it: `normalizeCardTextForComparison(cardTextToPlain(markup))`
   must equal the normalized `text`. The comparison ignores separator style
   (` -- ` vs `:`) and whitespace, but every word and every other punctuation
   mark must survive in order. `convert`, `review`, `check` and
   `src/__tests__/cardText.test.ts` all enforce this.
2. **No errata.** Markup reproduces the printed text verbatim, typos included.
   Log typos under [Errata candidates](#errata-candidates) instead.
3. **No spoils-game UI changes** during this phase; the work is all card data.
4. **Don't hand-edit `markup` in `data/cards.json`.** Put fixes in
   `data/card-markup/overrides.txt` and re-run `convert`. `convert` never
   rewrites a reviewed card unless you pass `--force`.
5. One set at a time, in the work order of the progress table. A reprint's
   markup is copied from its first reviewed printing, so later sets only cost
   their new cards.
6. Sub-agents only when the user asks for them, following the
   [parallel protocol](#parallel-sessions). On 2026-10-15 the user asked for
   parallel Sonnet sub-agents to finish the remaining sets, which overrides
   the no-sub-agent line in spoils-db `CLAUDE.md` for this work.

## Parallel sessions

The CLI is safe to run concurrently. `convert`, `review` and `progress` hold
a lock (`data/card-markup/.lock`) around their read-modify-write, and every
file it writes is written atomically. Each parallel session:

- **Owns one set's new names.** Always pass `--new` to `show` and `review`,
  and only `convert` your own set. A name belongs to the set where it first
  appears in work order, so the slices don't overlap.
- **Writes overrides only to `data/card-markup/overrides/<set slug>.txt`.**
  `overrides.txt` plus every per-set file are merged, and a card may be
  overridden in only one of them.
- **Doesn't edit** `scripts/`, `src/`, this file, `reviewed.json` or
  `cards.json` by hand, doesn't run `progress`, and makes no commits. A
  converter improvement goes in the session's report, with an override as
  the fix in the meantime.
- **Reports** reviewed counts, the overrides it added and why, errata
  candidates, and anything unresolved. The coordinating session merges those
  into this file.

After all parallel sessions finish, the coordinator runs `convert <set>
--force` for every set in work order. That re-copies reprints whose source
card was reviewed or overridden after the reprint's set was converted. Then
`check` must report 0 errors and no drift.

## Session workflow

```
cd ~/dev/spoils-db                       # branch card-text-markup
npm run card-markup -- progress          # where we are
npm run card-markup -- convert <set>     # write draft markup for the set's unreviewed cards
npm run card-markup -- show <set> --range 0:40 --unreviewed
#   read each card; for a wrong one, add an entry to data/card-markup/overrides.txt,
#   re-run convert <set>, show it again (--name "<card>")
npm run card-markup -- review <set> --range 0:40     # mark that chunk reviewed
#   ...repeat in chunks of ~40...
npm run card-markup -- check             # whole-catalog validation (exit 1 on errors)
npm run card-markup -- progress          # refresh the table below
node --import tsx --test src/__tests__/cardText.test.ts
```

Then add a line to the [Session log](#session-log). `<set>` is a set name or
slug. `--range a:b` indexes the alphabetical list of the set's names with
text, the `[n]` shown by `show`. Other `show` filters: `--flagged`,
`--name "<card>"` (repeatable).

State lives in three places:

- `data/cards.json`: `markup` on each printing (draft until its name is reviewed).
- `data/card-markup/reviewed.json`: reviewed card names, with optional notes.
- `data/card-markup/overrides.txt` and `data/card-markup/overrides/<set slug>.txt`:
  hand-written markup that replaces the heuristic draft. `ref`s can be left
  off; they're linked per printing.

## Review checklist

- **Blocks.** Each `<ability>` holds exactly its own COST / EXTRA COST /
  EFFECT parts. An `<option>` body ends where it should (the converter flags a
  last option that spans several segments). A standalone header merged with
  the next paragraph really is that paragraph's name.
- **Classification.** Ability names go in `<ability name>`, keywords in
  `<kw>`, Unique and Attach-to lines in `<keywords>`, and printed rule labels
  (STARTING DRAW, BULGE: …) in `<rule name>`.
- **Inline.** Every keyword in a sentence is `<kw>`. `UNIQUE X` references are
  `<unique>` covering exactly the designation. Reminder or aside parentheses
  are `<reminder>`, but math like `(10*X)` stays plain. Quoted card names and
  subtypes get `<card>` / `<subtype>`. Leftover all-caps words show up as
  `? unmarked caps` flags.
- **Refs.** Check each `<ability ref>` against the listed abilities. Faction
  DRAW/RESOURCE abilities are often engine built-ins with no ability entry,
  so unlinked is correct there; note it on review.
- **Typos.** Add them to Errata candidates. Don't fix them.

## Markup reference

Labels the card prints are implied by the tag (`COST: `, `UNIQUE `,
`ATTACH TO `, reminder parentheses, a grant's quotes) and are re-added by
`cardTextToPlain`. Resource icons stay as their printed `[R] [G] [D] [E] [O] [V]`
tokens. Syntax is only `<tag attr="v">` and `</tag>`: no entities, no
self-closing tags, text can't contain `<`. Attribute values are
single-quoted when they contain `"` (`name='"ENHANCE"'`). `threshold` and
`when` use lowercase `rgdeov` letters, like the card `threshold` field.

**Blocks** (top level, in printed order; also inside `<option>` and `<grant>`)

| Tag | Prints as | Meaning |
|---|---|---|
| `<keywords>` | as written | Keyword-style line: `<kw>`, `<unique>`, `<attach>` entries joined by `, `, optional `<reminder>` |
| `<rule name? when? ref?>` | `NAME: …` / `[O][O]: …` / `…` | A rules paragraph. `name` = printed all-caps label; `when` = printed icon prefix (see Decisions); `ref` = ability id (deferred, see Follow-ups) |
| `<ability name? threshold? ref?>` | `NAME: [E] -- COST: … -- EFFECT: …` | A printed costed ability; children `<cost>`, `<extra-cost>`, `<effect>`. `ref` = the card's matching `AbilityDefinition.id` |
| `<extra-cost>` | `EXTRA COST: …` | Card-level extra cost (tactic, or a permanent's on-play) |
| `<effect>` | `EFFECT: …` | Card-level labeled effect (inside modal options) |
| `<option label>` | `LABEL -- …` | One branch of a modal choice (`OPTION 1`, `2 TOKENS`); holds blocks |
| `<grant>` | `"…"` | Quoted rules text given to other cards; holds blocks; never linked to this card's abilities |
| `<flip-up>` | `FLIP UP: …` | |
| `<provides>` | `PROVIDES: …` | |
| `<fealty>` | `FEALTY: …` | |

**Inline** (inside any block's text)

| Tag | Prints as | Meaning |
|---|---|---|
| `<kw>` | as written | COVERT / TACTICAL / AGGRO only (`CARD_TEXT_KEYWORDS`) |
| `<unique>` | `UNIQUE …` | Unique designation (`<unique>PLUCK</unique>`) |
| `<attach>` | `ATTACH TO …` | Attach-to restriction |
| `<term>` | as written | All-caps rules term in a sentence (FLIP UP, RESTORE RULE, PROVIDES, …) |
| `<card>` | as written | Card named in the text; quotes stay outside the tag |
| `<subtype>` | as written | Subtype named in the text; quotes stay outside the tag |
| `<reminder>` | `(…)` | Parenthetical reminder or aside; can't nest |

Example (Abram Ka-darbo Alkazin):

```
<keywords><unique>PLUCK</unique></keywords>
<fealty>While this card is in your hand and you control at least 4 staple resources of different trades, reduce this card's threshold requirement by any 3 resource icons.</fealty>
<ability name="MAKE VANISH" ref="make-vanish">
  <cost>Deplete this card. Pick a character. Pay 5.</cost>
  <effect>Put that character into the void.</effect>
</ability>
<ability name="MAKE REAPPEAR" ref="make-reappear">
  <cost>Deplete this card. Pay 1.</cost>
  <effect>Put a character voided by this card into play under your control.</effect>
</ability>
```

## Progress

Generated by `npm run card-markup -- progress`; don't edit between the markers.
"New names" are cards first seen in that set (reprints of earlier sets are
free). "Printings with markup" counts every printing in the set.

<!-- progress:start -->
**Overall: 1193 / 1193 unique cards reviewed** (5 hand overrides).

| Set (work order) | Slug | Printings | With text | New names | Reviewed (new) | Printings with markup | Status |
|---|---|--:|--:|--:|--:|--:|---|
| 1st Edition | `1st-edition` | 226 | 206 | 206 | 206 / 206 | 206 / 206 | done |
| 1st Edition Part 2 | `1st-edition-part-2` | 165 | 163 | 163 | 163 / 163 | 163 / 163 | done |
| Open Beta | `open-beta` | 206 | 187 | 0 | 0 / 0 | 187 / 187 | done |
| Shade of the Devoured Emperor | `shade-of-the-devoured-emperor` | 130 | 126 | 126 | 126 / 126 | 126 / 126 | done |
| Seed | `seed` | 231 | 220 | 219 | 219 / 219 | 220 / 220 | done |
| Seed 2 | `seed-2` | 110 | 110 | 110 | 110 / 110 | 110 / 110 | done |
| Seed 3 | `seed-3` | 43 | 38 | 38 | 38 / 38 | 38 / 38 | done |
| 2nd Edition | `2nd-edition` | 300 | 286 | 0 | 0 / 0 | 286 / 286 | done |
| Seed Saga | `seed-saga` | 358 | 353 | 42 | 42 / 42 | 353 / 353 | done |
| Holy Heist | `holy-heist` | 165 | 142 | 141 | 141 / 141 | 142 / 142 | done |
| Ungodly Mess | `ungodly-mess` | 167 | 162 | 148 | 148 / 148 | 162 / 162 | done |
<!-- progress:end -->

## Expected flags

These show up in `convert`/`show` output and are usually fine:

- `unlinked ability "DRAW"` / `"RESOURCE"` on factions whose draw/resource
  abilities are engine defaults (no `behavior.abilities` entry). This also
  covers a faction's other named abilities when the faction has no ability
  entries at all.
- `positional link RECUR -> recur`-style links are correct when the ids line up.
- `last option "…" body spans N segments` asks you to confirm where the final
  option ends.

## Decisions

- **Markup string, parsed tree.** The stored form is a compact XML-like string
  (diffable, hand-editable). Consumers call `parseCardText` and never touch the
  string.
- **Implied labels.** Tags carry no printed label words, so renderers style
  labels themselves.
- **Separator-insensitive round-trip.** `normalizeCardTextForComparison`
  collapses any run of ` -- ` / `:` separators, so `OPTION 1: x` and
  `OPTION 1 -- x` compare equal and a grant's `...text: "A` lines up.
- **Linking.** Only `<ability>` blocks get `ref` for now, matched by name,
  then by an id containing the name, then by position. A tactic's first
  activated ability is its play ability and is never a link target.
  Abilities inside `<grant>` belong to other cards and are never linked.
- **Reprints.** Text is identical across printings of a name (verified), so
  review is per name. Refs are re-linked per printing, because 5 reprint
  groups use different ability ids.
- **Inline tagging scope.** `<subtype>` is applied to quoted subtypes
  (`'majig'`, `"gear"`) and to an unquoted lowercase subtype directly
  followed by card/character/item/location/token/subtype ("a gear card",
  "node characters", "the majig subtype"). Bare subtype words in other
  positions stay plain. `<card>` is applied to quoted card names and to the
  longest card name after "named " ("a card named Deception"). Token names
  ("Micromajig tokens") and trades ("Gearsmith characters") stay plain.
  Title-case "Restore Rule" / "Develop Rule" get `<term>` like the all-caps
  forms; lowercase "flip it" is ordinary English and stays plain.
- **Separate keyword lines stay separate.** `UNIQUE X -- TACTICAL` is two
  `<keywords>` blocks, matching the print. Only a comma-joined line
  (`TACTICAL, UNIQUE IOHANE`) shares one block.
- **Keywords match case-insensitively.** All three lowercase uses in the
  catalog ("this card gains tactical/covert": Parkour Hoodlum, Gargoyle of
  Cathédrale de Mau, Pride of Goru-Goru Gidea) are keyword grants, so they
  get `<kw>` with their printed case.
- **Trades stay plain, including lowercase ones.** "warlord character" is a
  trade reference (the engine reads `cardTradeIs warlord`), not a subtype.
- **Token subtypes.** `micromajig` appears on no card's `subtype` list, so the
  converter can't learn it. The one quoted use (Corrosive Waste Dispenser,
  `non-"micromajig"`) is tagged by override.
- **Single-sentence quoted grants stay inline.** `gains the rules text "…"`
  inside one paragraph (Lodge Dock Florist, Yenessa Shipping, LLP, Quilt of Old
  Banners, Discordant Cadencer) keeps the quotes as plain text in its
  `<rule>`. `<grant>` is only used when the quote spans several printed lines
  (Jo Ciendeilio, M07h3r 0f 1337 and the God's Blessing cycle).
- **Stray mid-sentence separators: KNOWN WRONG, blocked on a decision.**
  Headshot, Voidal Tactician and Wasted Wickedness have a ` -- ` inside a
  sentence. Their overrides currently keep it as literal text, which would
  display as "--". The card images show this is not a transcription slip:
  the stored `text` of these cards is a different version than the printed
  card (see [Source text fidelity](#source-text-fidelity)). The fix belongs
  in the source text, not the markup.
- **`<rule when>` is a CR §405.4 threshold paragraph, with one meaning.**
  A paragraph that begins with threshold icons "is only active while its
  controller is currently meeting that threshold" (CR §201.5d / §405.4).
  The card images confirm the print: icons, a dash, then a plain paragraph,
  with no ability name and no COST/EFFECT section (CR §201.5c says every
  ability has those). A threshold printed after an ability's name is an
  ability threshold (CR §405.3 / §502.2), which is `<ability threshold>`.
  The markup is right for all 63 cards with threshold paragraphs. 10 of them
  are modeled in the engine as cost-free activated abilities instead, which
  is an engine bug and doesn't affect display (see Follow-ups). A malformed
  prefix (Smokin' Hottie's `[V]V][V][V]:`) stays plain text.
- **Converter changes vs. reviewed cards.** After changing a heuristic, run
  `convert <done set> --force` for each finished set. It prints
  `!! --force changed REVIEWED markup: …` for any reviewed card whose output
  moved, and the new output has to be re-checked.

## Source text fidelity

`markup` is a faithful structuring of `text`; the round-trip check proves
that. How faithful `text` is to the printed cards is a separate question,
checked against `data/assets/<id>.jpg` on 2026-10-15:

- **`text` is current-rules wording, like Magic's "Oracle" text, not printed
  wording.** In a stratified random sample of 16 cards across all 11 sets, 6
  match the print exactly. 10 differ only by updated templating, with the
  same game meaning: "your opponent" → "an opponent", "both players" →
  "each player", a tactic's printed "COST – / EFFECT –" → "EXTRA COST:" plus
  an unlabeled effect, "removed from the game" → "void", "costs up to 3
  less" → "reduce … by 3". This is mostly on the 2006–2008 Tenacious Games
  printings. None of the 16 had a substantive error. The engine implements
  `text`, so displaying current-rules wording matches what the game does.
- **Some cards' `text` is substantively a different card version.** Found
  by targeted checks, all in Ungodly Mess. The engine copied these errors:
  - Wasted Wickedness: the print has `FLIP UP – 1 [O]` and "X is the number
    of different **types of** staple resources **they** control. Pay X+X."
    `text` has no FLIP UP, and the engine data has no `flipUp`. Its `text`
    also reads "Pay X -- +X."
  - Corrosive Waste Dispenser: the printed CONVERT cost starts "Pay 1."
    `text` and the engine cost both omit it.
  - Headshot: the print reads "…you may pick a character. Repeat this effect
    up to three more times." `text` spells the repeats out, with stray
    ` -- ` mid-sentence.
  - Voidal Tactician: the print reads "search that faction's **controller's**
    deck… **When** this card is depleted, you may deploy **a tactic** … as
    though **it were** in your hand without meeting **its** threshold." `text`
    differs, with a stray ` -- `.
- **Open question for the user:** how far to audit and correct. Finding
  every substantive mismatch means checking all 1193 cards against their
  images. Correcting one means changing `text`, which so far has been
  treated as archival, and the engine behavior.

## Errata candidates

Printed typos found during review. Recorded, not fixed (Ground rule 2).

- 12 Man Brunch of Doom: "If the the picked character"
- Meat of the Mountain: "That player's choses", "its owners's hand"
- Siluriformes Flaxenscale: ability "AURIFEROUS AUGMENTAION"
- Runic Circuitry: POWER-UP effect has no final period ("...this turn by 3")
- Auction House: "into their owners's deck"
- Recollection Bazaar: "into it's owner's hand"
- Subsection 5, Paragraph 12: "an ability that's source was not a faction"
- Irresistible Bribe: curly apostrophe in "That character’s controller's"
- "owners's" (for "owner's"): Mustache Aficionado, Reality Shift,
  Contiguous Defalcating Machine, Contractual Execution (twice), Officially
  Offensive Overseer, Super Shiny Caltrops of DOOM!, Confessions of Countless
  Souls
- Encumber: "EXTRA COST:Pick a character or location." (no space after the colon)
- Headhunting: "where X is number of [D] you control"
- Intriguing Mezzanine: "their controller's factions's restore rule"
- Banner of Betrayal: "and that characters gains 1 speed"
- Unbearable Torture: "greater than it's strength"
- Warmachine Smelder: "Pick and item you control"
- Draconic Luteoderm Suit: designation "UNIQUE DRACONIC LUTEDODERM SUIT"
- Runic Junker: "atleast 2", "At start of your turn"
- Juice Sale!: "If there is tie"
- This, That, and the Other Thing: "tatics" (three times)
- Greedy Profiteering: "Your faction loses 3 influcence."
- The Primitive Tribes of Thabbash: "Attached it to their faction."
- Breath of the Barduse: "destroys 2 character they own"
- Eidolic Cove: "you faction loses 4 influence"
- Party Crashers: "While this card in in an attacking party"
- Ritual of the Sucking Skull: "the cards's numeric cost"
- Vexillarius Dacian-Draco: "all character lose 2 strength and 2 life"
- Voidal Bask: "chose a card in it"
- Zenobia, Artificer: "Chose a number greater than 0 for X"
- Geldale, City-Fortress: "You opponents may only play tactics"
- Lockbox of the Aeons: no final period ("...discard pile or play")
- Thabbashite Penumbra: no final period ("gains 1 life and COVERT")
- Bloodcrazed Berserker: ability "HEMORAGE"
- Smokin' Hottie: icon prefix "[V]V][V][V]:"
- Headshot, Voidal Tactician, Wasted Wickedness: stray mid-sentence ` -- `
- Possibly intentional: "UNIQUE IGNATIOUS" on Ignatius Gloamspike and
  Seriously Weird Crystalline Artefact (IGNATIOUS is a catalog subtype)

## Follow-ups (out of scope for this phase)

- Link `<rule ref>` to triggered/continuous/replacement abilities.
- **Engine bug (behavior, not display):** 10 cards model CR §405.4
  threshold paragraphs as cost-free activated abilities with permanent
  effects. Fervent Beastslayer's `[R]x5` "+3 life", for example, can be used
  any number of times for free. They should be continuous abilities
  conditioned on the threshold. The cards: Boorish Boar, Shrouded Demon,
  The Abominable Hamster, Protractive Golem, Runic Armor, Obtuse Pipesmoker,
  Fervent Beastslayer, Heavy Sword, Righteous Exemplar, Soulsearcher.
- **Engine data bugs from the source-text mismatches above:** Wasted
  Wickedness is missing `flipUp`, and Corrosive Waste Dispenser's CONVERT is
  missing "Pay 1".
- Let `<ability ref>` link to a non-activated ability when the engine
  implements a printed costed ability that way (Phalludrix, the Impotenator
  EQUIP is a triggered `equip`).
- Teach the converter subtypes the engine reads via `cardSubtypeIs` but no
  card lists (e.g. `micromajig`), then drop the Corrosive Waste Dispenser
  override.
- Errata pass over the list above, if wanted (it would change archival
  `text`, so it's a deliberate separate decision).
- Backfill `AbilityDefinition.name` from `<ability name>` headers (about 80%
  of activated abilities are unnamed today).
- spoils-game renderer: replace `CardBodyText` with a tree renderer, and use
  `<ability>` blocks for the ability name/cost/effect in ActionDock,
  PendingChoicePanel and StackPanel.
- After every set is reviewed: delete the converter, `overrides.txt` and
  `reviewed.json`, and make `markup` in `cards.json` the hand-maintained
  source of truth (document it in spoils-db `CLAUDE.md`).

## Session log

- **2026-10-15, session 1.** Created branch `card-text-markup`. Built
  `src/cardText.ts` (types, parser, serializer, plain projection,
  normalizer; `./card-text` export), `CardDefinition.markup`, the converter
  and CLI (`scripts/card-markup/`), and `src/__tests__/cardText.test.ts`
  (unit tests plus the catalog round-trip check). The heuristic converter
  round-trips all 1193 unique texts with 0 errors; 31 cards are flagged
  across the whole catalog, mostly faction built-ins. Reviewed **1st
  Edition** (206) and **1st Edition Part 2** (163), with no overrides
  needed. Fixes made along the way: unquoted subtype/card-name tagging, a
  greedy "named X" match (LeoKaiser), and title-case rule terms. Copied
  markup onto **Open Beta** (187) and **2nd Edition** (286), which are all
  reprints. 842 printings now carry markup. The full spoils-db suite
  passes. **Next: Shade of the Devoured Emperor** (126 new), then Seed (219).
  Known flagged cards waiting in later sets: the Essence-of-* /
  Overindulge / Expedition Endeavour / Surreptitious Larceny / Shriever
  Breeding Program modal options; The Evil Alliance (`INFLUENCE =` line,
  DARING GAMBIT / OMNIPOTENCE merges); Alliance of Handy Weirdos and Union of
  Unextraordinary Miners (quoted names, unnamed faction abilities); Jo
  Ciendeilio, M07h3r 0f 1337 and the God's Blessing cycle (`<grant>`);
  Wasted Wickedness (`+X.` caps line); Thabbashite Penumbra (unnamed
  ability, positional link).
- **2026-10-15, session 1 (continued): migration complete.** At the user's
  request, six parallel Sonnet sub-agents reviewed the remaining sets under
  the [parallel protocol](#parallel-sessions). Before launch, the CLI gained a
  state lock, atomic writes, per-set override files and `--new`. Results:
  Shade of the Devoured Emperor 126/126, Seed 219/219, Seed 2 110/110,
  Seed 3 38/38, Seed Saga 42/42, Holy Heist 141/141, Ungodly Mess 148/148.
  The coordinator then made keyword matching case-insensitive, removed four
  overrides (three it made redundant, plus Rudo Mangod, Dragonweight
  Champion's `warlord` subtype, which is a trade), and ran `convert --force`
  over every set in order. Only Rudo Mangod's markup changed, and no reprint
  had drifted. A 12-card random spot-check of agent-reviewed cards was all
  correct. Final state: **1193/1193 unique cards reviewed, 1993/1993
  printings with text carry markup**, 5 hand overrides, `check` 0 errors and
  no drift, cardText tests 26/26, full spoils-db suite 4841/4841. Nothing is
  committed. Next phase (not started): the spoils-game renderer and the
  Follow-ups above.
