# Card data

`data/cards/<set id>.json` is the source of truth for the card catalog: one
file per set, one entry per **printing** (a card in a specific set), 12 sets in
total. `data/sets.json` lists the sets in catalog order; the catalog is the
set files concatenated in that order. `src/data/` is generated from them
(`npm run sync-cards`) — never edit it by hand. The
TypeScript shape is `CardDefinition` in `src/types/cards.ts`.

| File | What it is |
|---|---|
| `data/sets.json` | Every set's `id` and `name`, in catalog order. A set's id is its name lowercased with each run of other characters replaced by `-` (`Seed Saga` → `seed-saga`). Exported as `CARD_SETS` from `the-spoils/sets` (with card counts). |
| `data/cards/<set id>.json` | One set's printings: identity, stats, text, markup, flavor, art credits and engine `behavior`. Every printing's `set` is that set's name. Exported as `the-spoils/sets/<set id>`, and as `CARDS_<SET_ID>` (upper snake case, e.g. `CARDS_SEED_SAGA`) from `the-spoils/data`. |
| `data/card-audit/corrections.json` | Each printing's exact printed rules text, keyed by printing id, wherever it differs from the catalog `text` (with a reason). |
| `data/card-coverage.json` | Per-card implementation status. Generates `COVERAGE.md` and `data/card-fidelity.json` (`node scripts/build-coverage.cjs`; CI fails if they're stale). |
| `data/card-fidelity.json` | How faithfully the engine reproduces each card (`full` / `partial` / `stub`), exported as `CARD_FIDELITY` from `the-spoils/data`. |
| `data/raw-database.json` | The original card database dump the catalog was bootstrapped from. Kept for reference only; nothing reads it. |
| `data/assets/<id>.jpg` | One image per printing, plus the shared card back (`card-back.jpg`). Ships in the installed package, importable as `the-spoils/images/<id>.jpg`. |

## Ground rules

1. **The card image is the authority** for what a printing says.
2. **Every printing plays exactly as printed on its own card.** A 1st Edition
   card that a 2nd Edition reprint reworded still plays as the 1st Edition card
   says, so `behavior` is per printing and printings of one name may differ.
   Cards with the same name are still the same card for naming rules such as
   uniqueness and "named X" (CR 201.1b).
3. **`text` is archival.** It is the database's later, "Oracle"-style wording
   and is never edited. Where a printing's card says something different, the
   printed text goes in `corrections.json` and `markup` is generated from that.
   Typos are corrected there too, with the reason `typo`, never silently.
4. **Stats are gameplay fields**, not archival (cost, threshold, strength /
   speed / life, structure, influence, type, subtypes, rarity). They are fixed
   directly in the set file for each printing whose card disagrees.
5. **Names use the printed spelling.** Misprinted subtypes on a single
   printing (e.g. "nercomorph") are not reproduced.

## Text fields

- `text` — archival rules text, ` -- ` between printed lines.
- `markup` — the printed rules text (from `corrections.json` when present,
  else `text`) wrapped in a closed set of semantic tags. Parse it with
  `parseCardText` from `the-spoils/card-text`; render plain text with
  `cardTextToPlain`.
- `subtitle` — the line printed under the name (CR 201.1a).
- `flavorText` — italic descriptive text (CR 201.5e); not rules text.

### Markup reference

Labels the card prints are implied by the tag (`COST: `, `UNIQUE `,
`ATTACH TO `, reminder parentheses, a grant's quotes) and are re-added by
`cardTextToPlain`, so renderers style labels themselves. Resource icons stay
as their printed `[R] [G] [D] [E] [O] [V]` tokens. Syntax is only
`<tag attr="v">` and `</tag>`: no entities, no self-closing tags, text can't
contain `<`. Attribute values are single-quoted when they contain `"`
(`name='"ENHANCE"'`). `threshold` and `when` use lowercase `rgdeov` letters,
like the card `threshold` field.

**Blocks** (top level, in printed order; also inside `<option>` and `<grant>`)

| Tag | Prints as | Meaning |
|---|---|---|
| `<keywords>` | as written | Keyword-style line: `<kw>`, `<unique>`, `<attach>` entries joined by `, `, optional `<reminder>` |
| `<rule name? when? ref?>` | `NAME: …` / `[O][O]: …` / `…` | A rules paragraph. `name` = printed all-caps label; `when` = printed threshold prefix (the paragraph is only active while its controller meets that threshold, CR 405.4) |
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

Example (Abram Ka-darbo Alakazin):

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

Conventions:

- Only `<ability>` blocks get `ref`. A tactic's first activated ability is its
  play ability and is never a link target; abilities inside `<grant>` belong to
  other cards and are never linked.
- Separate printed keyword lines stay separate (`UNIQUE X -- TACTICAL` is two
  `<keywords>` blocks); only a comma-joined line shares one block.
- A single-sentence quoted grant inside one paragraph stays inline as plain
  text in its `<rule>`; `<grant>` is used when the quote spans several printed
  lines.
- `<subtype>` is applied to quoted subtypes and to an unquoted lowercase
  subtype directly followed by card / character / item / location / token /
  subtype. `<card>` is applied to quoted card names and to the longest card
  name after "named ". Token names and trades ("Gearsmith characters") stay
  plain.
- `normalizeCardTextForComparison` collapses runs of ` -- ` / `:` separators,
  so round-trip checks are separator-insensitive.

## Art credits

`art` (`PrintingArt`) records who drew a printing's art, per printing, because
art and its credit can change between sets. Absent means unknown; nothing is
guessed.

- `artists` — canonical names in credit order, using the card's own spelling.
  Names are never merged without proof (`Dan Wong`, `Zi Jian` and
  `Dan Wong Zi Jian` are three entries). Empty for a joke credit naming no
  one.
- `credit` — the credit exactly as printed, when the printing prints one.
- `source` — `"printed"` (credited on this card) or `"sameArt"` (copied from
  another printing of the same artwork, named by `fromPrintingId`).
- Concept / design credits ("original Open R&D concept by …") are part of the
  `subtitle`, not `art`.

## Decade of Deckadence

The 156 Decade of Deckadence printings were added from card art published on
spoilsdigital.com; everything about them was transcribed from the images
(240×336 scans, converted to JPEG without upscaling). Each card was read twice
independently and the reads reconciled, with disagreements resolved by hand.
Caveats specific to this set:

- Fields that couldn't be read hold the literal `[MISSING]`
  (currently three subtitles). Most artist footers were illegible at that
  resolution, so about half the set has no `art`.
- No rarity or collector number is printed on these cards.
- Dual-trade resources print two trades; `trade` holds the first.

## Editing card data

- Edit card data through a patch module run by
  `node scripts/patch-cards.cjs <patch.cjs>` (it takes a lock, applies the
  patch to the whole catalog, rewrites only the set files whose contents
  changed and re-runs `npm run sync-cards`). A patch may add or remove
  printings; each is filed under the set its `set` field names.
- To add a set, add it to `data/sets.json` (its position is its place in
  catalog order) and patch its printings in; `sync-cards` generates its
  module and entry point.
  `data/card-audit/other-reveals.patch.cjs` shows the shape; it is also kept
  as a regression check (`other-reveals.test.ts` re-applies it and expects no
  change).
- Engine behavior is authored from the closed vocabulary described in
  `BEHAVIORS.md`. After changing behavior or classification, run
  `node scripts/build-coverage.cjs` and `npm run card-tests -- build`, then
  `npm test` (see `docs/TESTING.md`).
