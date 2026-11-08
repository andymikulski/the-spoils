# Multiplayer card spec

For every clause the inventory (`data/card-tests/mp-inventory.json`) marks as
multiplayer-relevant, this records what the printed text means at a table of
3 or more players. Each entry also lists which behavior-data sites have to
change and what the 3- and 4-seat tests must assert.

The spec comes from the printed text (the clause manifest's markup, or
`data/card-audit/corrections.json` where it applies), the rules
(`data/rule-tests/source/cr-2.5.txt`, `faq-2.0.txt`,
`docs/rules/multiplayer-guidelines.md`) and the rulings
(`data/rule-tests/rulings.md`, plus the "Rulings" section of
`docs/MULTIPLAYER-PLAN.md`). It is never taken from the current behavior
data, which was written for two players.

There is one file per set: `<set id>.json`. Writers work set by set.

## Format

`<set id>.json` is an array in the same order as that set's entries in
`mp-inventory.json`. Only groups with at least one relevant clause appear:

```jsonc
{
  "id": "<group id, as in mp-inventory.json>",
  "name": "<card name>",
  "clauses": [
    {
      "key": "<clause key, as in mp-inventory.json / clauses.json>",
      "status": "changes" | "unchanged" | "question",
      "readings": [
        { "phrase": "<printed words>", "at": <offset from the inventory>, "meaning": "<meaning id below>", "note": "<optional>" }
      ],
      "dataChanges": [
        { "path": "<behavior path, from the inventory when it lists one>", "now": "<current value>", "meaning": "<meaning id>", "edit": true, "why": "<optional>" }
      ],
      "test3": "<what a 3-seat test asserts: name P1 (controller), P2 (left of P1), P3; who is affected, who is not, which choices appear>",
      "test4": "<required when a reading is eachOpponent / eachPlayer / eachOtherPlayer; otherwise omit>",
      "questions": ["<id of an entry in questions[] below>"]
    }
  ],
  "questions": [
    { "id": "MPQ-<set id>-<n>", "clause": "<key>", "question": "...", "readings": ["(A) ...", "(B) ..."], "recommendation": "..." }
  ]
}
```

- **`dataChanges`** lists **every** behavior site that holds a player word other
  than plain `self` / `controller` / `owner` / a specific card's owner or
  controller, each with its meaning.
  - `edit: false` means the stored value can stay as it is. Example: a printed
    "your opponent" over data `"opponent"`. The spelling keeps working and
    only the engine's binding changes.
  - `edit: true` means the data must change: a different word, a new pick
    step, iteration, or a new field. A site with no player word yet (a
    boolean flag such as `noResponse`, a missing pick) is listed with its real
    path and `edit: true`.
- **`unchanged`** — no `dataChanges` entry has `edit: true`. The clause
  behaves identically at every table size. Its
  player words are only `self` / controller / owner of a specific card, or it
  already says exactly what the printed text means for N players. It still
  needs `test3`, so the claim is proven.
- **`changes`** — at least one `dataChanges` entry has `edit: true`.
- **`question`** — the printed text plus the rules and rulings do not settle
  3+ player behavior. Record the readings and a recommendation, and don't pick
  one. Every question raised in the first pass has now been ruled (see
  "Pattern rulings" below), so a new `question` needs a pattern those rulings
  don't cover.

## Meanings

| id | Meaning |
|---|---|
| `self` | The block's controller (for a selector: cards the controller controls/owns). |
| `chosenOpponent` | "your opponent": the one opponent the block's controller chooses for this block of rules text (MP 2, MP 4). Every "your opponent" in the same block is the same player. Played cards and activated abilities choose it before targets. Triggers choose it when they resolve. Lasting effects choose it when they start applying, and choose again if that player is eliminated (RQ-mp-5). A condition such as "only during your opponent's turn" is satisfied by choosing the active player. With exactly one opponent left, no choice is offered. |
| `chosenPair` | "both players": the controller and the block's `chosenOpponent` (MP 3). |
| `selfAndEachOpponent` | "both players" on The Knitting Coalition only (RQ-mp-6). |
| `eachOpponentOfSelf` | "your opponent" on The Knitting Coalition's HIDDEN INFLUENCE / PULLING STRINGS only (RQ-mp-6): every opponent. |
| `anyOneOpponent` | "an opponent" / "any opponent": a single opponent, settled by the pick or choice the sentence makes (the controller or owner of the picked card), or chosen by the controller if nothing in the sentence settles it. In a selector ("a character an opponent controls"), it matches the cards of any opponent. |
| `eachOpponent` | "each opponent", "your opponents", "opponents": every opponent still in the game. When they act or are affected one at a time, the order is the active player first, then clockwise (CR 402.2). |
| `eachPlayer` | "each player", "all players": every player still in the game, active player first, then clockwise (CR 402.2). |
| `eachOtherPlayer` | "each other player": every player except the controller. |
| `anyPlayer` | "any player", "a player": whichever player the sentence lets act or pick (for example "Any player may use this ability"). |
| `activePlayer` | The player whose turn it is. |
| `refersBack` | "that opponent", "that player", "their opponent", "the picked player": the player an earlier phrase in the same block settled. Name that phrase in `note`. |
| `cardRelative` | The controller or owner of a specific card ("its controller", "the owner of that character"). The same at every table size. |
| `seatRotation` | Emergency Obfuscation's "each player moves 1 seat to the left". |
| `other` | None of the above. Explain in `note`, and raise a question if it is not obvious. |

A block of rules text is one clause (one printed paragraph or ability). If a
clause's data is split across several abilities, or one ability spans
several clauses, note it on the clause (`"note"` in `readings`, or a `why` on
`dataChanges`).

## Pattern rulings (user, 2026-11-07: "all recommended")

These settle every question from the first pass. Each one is recorded in
`data/rule-tests/rulings.md` as MPQ-P1 to MPQ-P11.

- **MPQ-P1, printed text governs.** The printed markup (or
  `corrections.json`) is the spec. The archival `text` field's later
  rewording is ignored.
  - Emergency Obfuscation ("both players switch seats. Both players are in
    control of their opponent's side.") swaps seats and sides between the
    controller and one `chosenOpponent` (MP 3). Nobody else moves. The meaning
    is `chosenPair`, not `seatRotation`.
- **MPQ-P2, conditional lasting text.** "While your opponent controls / has
  …" (Clockman Pickpocket, Cute Cutpurse, Adroit Marauder, Sleeping Guard)
  follows RQ-mp-5: the opponent is chosen when the effect starts applying,
  kept while it lasts, and chosen again if that player is eliminated.
- **MPQ-P3, replacements.** "Your opponent" in a replacement (Phalludrix,
  Lucky Bastard) is chosen at the moment the replacement applies.
- **MPQ-P4, Mistaken Identity.** "Your opponent" is the controller of the
  card or ability being responded to. Nobody chooses.
- **MPQ-P5, trigger conditions naming "your opponent".** "If your opponent
  plays / attacks / plays a resource …", "If a character enters play under
  your opponent's control", "If a character your opponent controls is
  destroyed" (Slingerang, Guardforce Morphmajig, Sadistic Colonel, Runivoltaic
  Accumulator, Watchtower, Swinish Elder, Silencer, Octo-Ba-Ba):
  - any opponent's action triggers it;
  - that opponent is the block's `chosenOpponent` for that trigger, with no
    choice offered.
  - This overrides RQ-mp-5 for trigger conditions; RQ-mp-5 still governs
    lasting static text.
- **MPQ-P6, "either deck" / "any deck".** The controller's deck, or the deck
  of one opponent the controller chooses (`chosenOpponent`). Affects Nearby
  Serpent, Arcanist's Almanac, Rigged Tables, Sly Bilker and Infatuated
  Armchair.
  - Where the printed text says "any deck" (Rigged Tables' "any deck"
    reading), it is every player's deck.
- **MPQ-P7, "Any opponent may pay N. If they do … Otherwise …" and "any
  player may pay".**
  - The offer goes to each eligible player in turn. For "any opponent", the
    order is clockwise from the controller's left. For "any player", it is the
    active player first, then clockwise (CR 402.2).
  - The first player to pay settles it ("they" is that player).
  - If everyone declines, the "Otherwise" branch happens.
  - Affects Additional Tribute, Offering of False Friendship, Thabbashite
    Barbeque, Unloyal Necromorph, Tedious TriAdic Truculence and Recycling
    Scheme Facility.
- **MPQ-P8, "your opponent" in battle text.** When the block is about a
  battle the controller is in (Wyrmfang Deathskull, Bask Bomb, Dragon Tank,
  Venomous Sacspider, Catastrophic Betrayal, Sarcophyle Matriculation,
  Lugubrian Octopod and the like), "your opponent" is the other side of that
  battle: the defending player if the controller attacks, the attacking player
  if the controller defends. No choice is offered. Outside a battle, MP 2
  applies.
- **MPQ-P9, "an opponent" with a superlative, total or "all".** One opponent
  is chosen (`anyOneOpponent`), and the superlative, count or "all" is
  evaluated within that opponent's cards only. Affects Subordinate
  Demotivation, Juice Sale!, Spitting Sarume, Drivey Car, Time Traveler
  Tourist Trap, Carnival Whipmaster (both cards from the same opponent),
  Martial Arts Wannabe and Underhanded Gamer ("those players" = the chosen
  opponent). A multi-card pick from "an opponent's discard pile" comes from
  one pile.
- **MPQ-P10, text from another player's point of view.**
  - Free Trade Agreement ("that player … their opponent"), Obscene Communion
    ("both players" on another player's turn) and Meat of the Mountain ("that
    player's opponent"): the acting player picks one of their own opponents,
    and "both players" is the acting player plus that pick.
  - Mercenary's Creed's "Both players may use this ability" is ruled like The
    Knitting Coalition: the controller and every opponent may use it
    (`selfAndEachOpponent`).
- **MPQ-P11, Gideon's Legacy.** "Each other player's faction gains X" means
  every player except the picked player.
