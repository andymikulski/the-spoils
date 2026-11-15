# Epic Rules

Transcribed verbatim from the printed rules insert card (`source/epic_rules.jpg`). Atom ids (`EP n`) are stable and are cited from `RULES.md` §16 and
the rules test suite (`data/rule-tests/source/epic.txt`, batch r11-general-loops-bidding).

## Verbatim text

> **Overview**
> Epic cards feature rare, powerful, and generally crazy effects. They are
> designed to be used for fun only, but there are circumstances when they may
> be used in tournaments (see below). You can identify epic cards by looking
> for the word "EPIC" at the bottom of the card, next to the set icon.
>
> **Card Limit**
> You may include only 1 copy of each epic card in your Constructed deck.
> Epic cards are not available during Limited play.
>
> **Epic Tournaments**
> Normally, epic cards cannot be used in tournament play. However, a
> Tournament Organizer may choose to run an "epic tournament" during which
> players may use these powerful cards. If your local community enjoys
> playing this way, you are encouraged to ask your Tournament Organizer to
> set up such an event.

## Atoms

- **EP 1** — A card is epic if its printed rarity mark (bottom of the card,
  next to the set icon) reads "EPIC". In the catalog this is `rarity: "epic"`;
  the Showdown factions print "E-SLE" (`rarity: "e-sle"`), which is also epic.
- **EP 2** — A Constructed deck may include at most 1 copy of each epic card.
- **EP 3** — Epic cards may not be used in Limited play.
- **EP 4** — Epic cards may not be used in tournament play, unless the
  tournament is an "epic tournament".

## Catalog note

The only epic printings in the catalog are seven Seed 3 faction cards:
The Society of Magical Propriety, The Knitting Coalition, The Union of
Unextraordinary Miners, Imperial Army, Counter-Imperial Army (`epic`), and
The Evil Alliance, Slightly Less Evil Alliance (`e-sle`). This was checked by
reading the rarity mark of every printing from its card image. Factions are
already limited to one per deck, so EP 2 never binds on the current catalog;
it is still enforced generally (`getMaxCopies`).

The five `epic` factions (and the promo The Open R&D Faction) also print
"This card cannot be used in tournament play" (`notForTournamentPlay`). The
card beats EP 4 (CR 101.1), so they stay out of epic tournaments too. Of the
epic printings, only the two Showdown factions are allowed at an epic
tournament.
