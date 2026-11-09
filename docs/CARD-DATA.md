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

- Subtitles and artist credits the scans left illegible (three subtitles,
  78 art credits) were later filled in from physical copies of the cards.
- No rarity or collector number is printed on these cards.
- Dual-trade resources print two trades; `trade` holds the first.

## Player words (multiplayer)

A card's `behavior` has to say what each printed player phrase means at a
table of three or more players, and say it the same way at two. A phrase's
meaning comes from the printed `markup` (never the archival `text`), the
Multi-Player Guidelines and the rulings (RULES.md §15; atoms in
`data/rule-tests/source/multiplayer.txt`, rulings in
`data/rule-tests/rulings.md`). The forms below are the whole vocabulary; the
types are in `src/types/expressions.ts`, `cards.ts` and `effects.ts`, and
BEHAVIORS.md ("Player vocabulary") says what each one does.

A **block** is one activated ability, one triggered ability, one paragraph of
continuous text or one card's effect text. "Your opponent" is one player,
selected per block (MP 2), and every "your opponent", "that opponent" and
"both players" in the block is the same player.

| Printed phrase | Meaning | Data form | Example |
|---|---|---|---|
| "your opponent", "that opponent", "their opponent" | The block's opponent, selected by the controller (MP 2, MP 4) | `"opponent"`; the spelling is unchanged from two-player data, only the engine's binding differs | Dragon Tank: `{ "controller": "opponent", "type": "character" }` |
| "both players" | The controller and the block's opponent (MP 3) | `forEachPlayer { players: "pair" }` | Spastic Tentacles |
| "an opponent", "any opponent" | One opponent, settled by the pick or choice the sentence makes | `controllerOf` / `ownerOf` of that pick; or `"opponents"` in a selector, scope or condition (any opponent); or a player choice (below) when nothing in the sentence settles it | Omahkapi'si Pi'kssii: `{ "zone": "discard", "owner": "opponents" }` |
| "an opponent" with a superlative, total or "all" | One opponent is chosen, and the comparison is made in that opponent's cards (MPQ-P9) | `anyOpponent { condition }`, with `"opponent"` inside it meaning each opponent in turn | Nefarious Horror: "While an opponent controls more characters than you" |
| "each opponent", "your opponents", "opponents" | Every opponent | `forEachPlayer { players: "opponents" }`; or `"opponents"` as an effect's `player`, a selector's `controller` / `owner` or a cost modifier's `affects` | Swindle: `forEachPlayer { players: "opponents", ... }`; Temple of Rantzigore: `"controller": "opponents"`; Lucky Charm: `pickTax[].affects: "opponents"` |
| "each player", "all players" | Every player, active player first | `forEachPlayer` (default `players: "all"`) | Obscene Communion |
| "each other player" | Every player but the controller; after a pick, every player but the picked one (MPQ-P11) | `forEachPlayer { players: "others" }`, with `except` after a pick | Gideon's Legacy: `{ "players": "all", "except": { "type": "ownerOf", ... } }` |
| "you and an opponent", "an opponent" with nothing to settle it | A player the controller names | `playerChoices: [{ id, from: "opponents" }]` on the ability or `onPlay` (named with the action), or a `choosePlayer { id, from }` effect (named while resolving); read back as `{ "type": "chosenPlayer", "id" }` | Day of the Tentacle: `playerChoices: [{ "id": "opp", "from": "opponents" }]`; Chain Reaction: `choosePlayer` then `factionOf { chosenPlayer }` |
| "that player", "the picked player" | A player already named in the block | The same `chosenPlayer` reference, or `controllerOf` / `ownerOf` of the earlier pick | Day of the Tentacle: "under that opponent's control" is `controller: { "type": "chosenPlayer", "id": "opp" }` |
| "its controller", "that character's owner" | A specific card's controller or owner, the same at every table size | `controllerOf` / `ownerOf` of that card | |
| "any opponent may pay N. If they do ... Otherwise ..." | Offered to each opponent clockwise; the first to pay settles it (MPQ-P7) | `mayPay { offerTo: "opponents", costs, effects, elseEffects }`, with no `player` | Additional Tribute, Offering of False Friendship |
| "any player may pay N" | Offered to each player, active player first | `anyPlayerMayPay { costs, effects, elseEffects? }` | Recycling Scheme Facility |
| "any opponent may pay" in a replacement | Offered to each opponent who can pay | the replacement's `chooser: "opponents"` | Unloyal Necromorph |
| "your opponent cannot respond" | Only the block's opponent may not | `behavior.noResponse: "opponent"` (`true` for "your opponents cannot respond", nobody may) | Subsection 5, Paragraph 12; Swindle (`true`) |
| "your opponent cannot pick / take control of this card" | Only the selected opponent | restriction `cannotBePickedByOpponent` / `cannotBeTakenControlByOpponent`; the plural `...Opponents` / `cannotBeTakenControl` cover every opponent | Martial Artist, Mountainous Golem |
| "... cannot pick this card while an opponent has ..." | The restriction binds each opponent who meets the condition | `cannotBePickedByOpponents` with `opponentCondition` | Omahkapi'si Pi'kssii |
| "your opponent must pay N to use a character's ability" | The selected opponent | `abilityCostModifiers` scope `chosenOpponentCharacters` (`opponentCharacters` for every opponent) | Department of Rejections |
| "at the start of your opponent's next turn" | That opponent's own next turn | `scheduleEffect { when: "startOfOpponentNextTurn" }` | Final Countdown |
| "X is the number of opponents you have at the start of the game" | Counted from the seats when the game starts | `faction.perExtraOpponent` | The Evil Alliance |
| "that opponent" in a later ability, for the rest of the game | A stored player | `rememberPlayer { key, player }` and `{ "type": "rememberedPlayer", "key" }` | I Drink Your Milkshake! |
| "cannot be blocked by that player's characters" | Only in a battle against that player | `grantKeyword cannotBeBlocked` under a `defendingPlayerIs` condition | Underhanded Gamer |
| "both players switch seats" | The controller and the selected opponent switch | `swapsSides` on a continuous ability | Emergency Obfuscation |

**Where the opponent comes from.** `"opponent"` is selected by the controller
unless the ability says otherwise with `opponentFrom` (default `"choose"`):
`"event"` when a trigger's condition names the opponent through the event's
player ("if your opponent plays a character", any opponent's action triggers
it, Slingerang), `"battle"` when only a battle the controller is in can set the
block off ("if you attack, your opponent ...", the other side of the battle;
Architectural Restitution), `"respondedTo"` for text answering another player's
card or ability (Mistaken Identity), and `"acting"` for text written from
another player's point of view (Free Trade Agreement: "that player ... their
opponent"; there `"acting"` is "that player", `"opponent"` is "their opponent"
and `forEachPlayer { players: "pair" }` is "both players"). The engine derives
`"event"` and `"battle"` when the field is absent; write the field whenever the
data would otherwise read the wrong player. Continuous text selects when it
starts applying and again if that player is eliminated (RQ-mp-5).

**Cards that mean something different on their own.** The Knitting Coalition
says "both players" and "your opponent" and means every opponent
(`usableBy: "anyPlayer"`, `overridesOpponent`; RQ-mp-6). A printed phrase wins
over the archival wording where they differ (MPQ-P1: Emergency Obfuscation).

### The forms the gate accepts

`data/card-tests/mp-spec/<set id>.json` records, for every clause with a
printed player phrase, what it means (`meaning`) and which behavior sites have
to change (`dataChanges`); `data/card-tests/mp-spec/README.md` documents the
format and the pattern rulings. An edited site is accepted once it holds a
form the engine reads for its meaning (`MEANING_FORMS` in
`src/engine/__tests__/clauses/_mpWorklist.ts`):

| Meaning | Accepted data |
|---|---|
| `chosenOpponent` ("your opponent") | `"opponent"`, or `{ type: "chosenPlayer", id }` |
| `anyOneOpponent` ("an opponent") | `controllerOf` / `ownerOf` of the pick, `{ type: "chosenPlayer", id }`, or `"opponents"` in a selector, scope or condition; never as an effect's `player`, which would act on every opponent |
| `eachOpponent` | the site inside `forEachPlayer { players: "opponents" }`, or `"opponents"` as an effect's `player` or in a selector / scope; not in a condition (that means "some opponent"), and not as a `chooser` or a target's `player` (the engine refuses both) |
| `eachPlayer`, `eachOtherPlayer`, `chosenPair`, `selfAndEachOpponent` | `forEachPlayer` with `players` `"all"`, `"others"`, `"pair"`, `"selfAndOpponents"` |
| `refersBack` ("that player") | `{ type: "chosenPlayer", id }`, `controllerOf` / `ownerOf`, or `"acting"` in an `opponentFrom: "acting"` ability; a selector's controller / owner cannot read `"acting"`, so it holds `"any"` with a `targetOwnedBy { player: "acting" }` condition |
| `cardRelative` | `controllerOf` / `ownerOf` |
| `other` (Gideon's Legacy) | `forEachPlayer` with `players` `"all"` or `"others"` and an `except` |
| an `opponentFrom` site | `"acting"` |

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
