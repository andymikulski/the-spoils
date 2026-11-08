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
        { "path": "<behavior path from the inventory>", "now": "<current value>", "meaning": "<meaning id>", "why": "<optional>" }
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

- **`unchanged`** — the clause behaves identically at every table size. Its
  player words are only `self` / controller / owner of a specific card, or it
  already says exactly what the printed text means for N players. It still
  needs `test3`, so the claim is proven.
- **`changes`** — at least one data site needs a different meaning.
- **`question`** — the printed text plus the rules and rulings do not settle
  3+ player behavior. Record the readings and a recommendation, and don't pick
  one.

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
