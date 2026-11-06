# The Spoils — Lore Reference

A collected, organized reference of everything the card catalog *says* about the world of
The Spoils. There is no official lore resource, so the only source is the cards themselves:
flavor text, subtitles (the short tagline under a card's name), card names, subtypes and
trades. Nothing here is invented.

## Ground rules (read these first)

1. **Collect, don't connect.** Each fact is attributed to the card(s) that state it.
   If two cards share a name or a surname, they are listed side by side — the docs do
   **not** say they are the same person, related, or contemporaries unless a card says so.
2. **Quotes are verbatim.** Spelling, punctuation and leetspeak are exactly as printed
   (including typos such as "Elizibeth" or "Amdell"). Variants across printings are noted in
   `meta/contradictions.md`.
3. **Source tags.**
   - *flavor* — the italic quote/caption at the bottom of a card (default when a quote is shown).
   - *subtitle* — the tagline under the card name (always marked "subtitle").
   - *card data* — name, trade, subtype, type, set. Subtypes are used as the card's own label
     (e.g. `mau`, `dragon`, `31f`), not as a lore explanation.
4. **Humor register.** The catalog is a comedic parody. Many lines are gags, pop-culture
   riffs, or fourth-wall jokes. They are still recorded, but obvious non-diegetic material
   (artist credits, "Open R&D" credits, references to the design team) is quarantined in
   `meta/credits-and-meta-jokes.md`. Where an in-world line is clearly a gag, it is marked ⚠.
5. **Gaps are left as gaps.** When a card name-drops something it never explains, that goes
   in `meta/unexplained-references.md` rather than being filled in.

## Directory map

| Path | What's in it |
|---|---|
| `world/geography.md` | Every place, region, sea, building and district named on a card |
| `world/timeline.md` | Events as the cards state them, with the in-world sourcing of each |
| `world/set-storylines.md` | The story-driven sets (Seed Saga, Holy Heist, Ungodly Mess, Shade of the Devoured Emperor) card by card |
| `world/voidal-magic.md` | The Void, Voidal Humour, ecto-work, rituals, witch clocks, runes |
| `world/technology.md` | Majigs, micromajigs, nodes, golems, kaisers, luteoderm, runic engineering |
| `world/religion-and-gods.md` | Living Gods, Zigalburgonglgr, Thabbashite worship, other religions |
| `world/society-law-and-money.md` | Banking, law, bureaucracy, crime, military, the dead as an economy |
| `world/daily-life-and-culture.md` | Food, drink, sport, entertainment, sayings, publications, calendar |
| `peoples/` | Mau, elves, Thabbashites, sarcophyles, the dead, seraphim/dragons, monsters, humans and others |
| `factions/factions-and-organizations.md` | Every faction card plus every in-world organization |
| `trades/` | The five trades (Arcanist, Banker, Gearsmith, Rogue, Warlord) and the Universal/Voidal cards |
| `characters/` | Named individuals, grouped by where the cards place them |
| `families/family-names.md` | Recurring surnames/house names and every relationship a card explicitly states |
| `meta/npc-toolkit.md` | Names, occupations, speech patterns and hooks harvested for NPC generation |
| `meta/glossary.md` | A–Z of in-world terms |
| `meta/contradictions.md` | Conflicting or inconsistent statements, left unresolved |
| `meta/unexplained-references.md` | Things mentioned but never defined |
| `meta/credits-and-meta-jokes.md` | Artist credits and fourth-wall material, excluded from canon |
| `archive/` | **Lossless** dump of every flavor text and subtitle, grouped by card type and trade |

## Scale of the source

- 2,101 card entries across 11 sets (1st Edition, 1st Edition Part 2, 2nd Edition, Open Beta,
  Seed, Seed 2, Seed 3, Seed Saga, Holy Heist, Ungodly Mess, Shade of the Devoured Emperor).
- 1,165 entries carry flavor text; 1,978 carry a subtitle. After de-duplication across
  reprints, ~1,430 distinct texts.
- Lore density is uneven: Seed Saga, Holy Heist, Ungodly Mess and Shade of the Devoured
  Emperor are noticeably more world-building than the 1st/2nd Edition and Seed sets, which are
  mostly one-liner jokes.

## Using this for NPC generation

Start with `meta/npc-toolkit.md`, then read the relevant `peoples/` and `trades/` file for
the NPC's background and `world/geography.md` for a believable home. For tone, read a few
entries in `archive/` for the same trade — voice varies sharply (Mau speak in finance/legal
jargon, gearsmith "31f" in leetspeak, warlords in bluster and gore).

## Provenance

The `archive/` files are generated from `data/cards.json`. Everything else is hand-curated
from reading those archive entries end to end. If `data/cards.json` is updated with new
flavor text, the archive needs regenerating and the curated files need a review pass.
