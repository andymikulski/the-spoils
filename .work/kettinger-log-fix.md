# "Where did Kettinger go?" — log detail + attachment rendering

## What actually happened in your game

Two different Kettinger copies, which the old log ran together:

- `card_88` (p2's, in hand) was **discarded** by your Swarm of Gnats at seq 60
  — "Kettinger moves from hand to discard". Not played.
- `card_87` (p2's) was **played** at seq 71 and entered play at seq 75.
  Kettinger is `ATTACH TO CHARACTER` gear, and p2 controlled no characters
  at that point (Berserker Corps died at seq 68), so it attached to one of
  **your** characters (Servile Centipede / Swarm of Gnats). Legal — gear
  with no "you control" clause can ride an opponent's creature.

So it never vanished. It was hanging off one of your characters, buffing it
+2 strength. Two things hid that:

1. **The log didn't say what it attached to.** `cardEnteredPlay` just printed
   "Kettinger enters play".
2. **spoils-game didn't render it.** `PlayerBoard` built its attachment map
   only from that player's own `play` list, so gear controlled by p2 sitting
   on a p1 character belonged to neither board and drew nowhere.

## Fixes

### spoils-db (engine)

| Change | Effect |
| --- | --- |
| `cardEnteredPlay` log line names the host | `Kettinger enters play attached to Servile Centipede` |
| new `cardAttached` event + log line | HANDOFF / re-home shows as `Relocator attaches to Bravo` |
| **new `SpoilsEngine.exportState()`** | full JSON snapshot: every zone by card name, influence, deck size, faction card, damage/depletion/counters/effective stats, `attachedTo` (host name) and `attachments` (host → its gear), response stack, pending choice |

Tests: `src/engine/__tests__/export-state.test.ts` (5), plus the game-log
attach tests. Full suite green (2585).

### spoils-game

| File | Change |
| --- | --- |
| `PlayerBoard.tsx` | attachment map now scans **every** in-play card, so gear on an opponent's character renders stacked behind that character |
| `GameController.ts` | `getStateSnapshot()` wrapper over `exportState()` |
| `GameLog.tsx` | export payload now carries `snapshot: controller.getStateSnapshot()` alongside `entries` |

Tests: `AttachedCards.test.tsx` cross-controller case, `GameLog.test.tsx`
snapshot assertions. Suite green (core 83, web 81).

## New export shape

```jsonc
{
  "exportedAt": "...",
  "entryCount": 83,
  "entries": [ /* unchanged event log */ ],
  "snapshot": {
    "turn": 6, "activePlayerId": "p2", "priorityPlayerId": "p2", "mode": "main",
    "responseStack": [],
    "players": [
      {
        "id": "p1", "name": "Player 1", "influence": 20, "deckCount": 0,
        "faction": { "id": "card_1", "name": "...", "type": "faction" },
        "hand": [], "discard": [], "void": [], "removed": [],
        "play": [
          { "id": "card_3", "name": "Servile Centipede", "type": "character",
            "strength": 4, "life": 3, "attachments": ["card_4"] }
        ]
      },
      {
        "id": "p2", "name": "Player 2", "influence": 20, "deckCount": 0,
        "faction": { "id": "card_2", "name": "...", "type": "faction" },
        "hand": [], "discard": [], "void": [], "removed": [],
        "play": [
          { "id": "card_4", "name": "Kettinger", "type": "item",
            "attachedTo": { "id": "card_3", "name": "Servile Centipede" } }
        ]
      }
    ]
  }
}
```

`card_4` (Kettinger) is in p2's `play`, `attachedTo` Servile Centipede;
Servile Centipede in p1's `play` lists it back under `attachments` and shows
`strength: 4` (2 + 2). No log replay needed to find a card.

## Note

Another session was editing the same engine files while this ran (added
`influenceChanged` / `statModified` / `gameEnded` events, committed as
`5809e88 "fix export, etc"`). Everything is merged and green, but nothing
here is committed by me — review `git diff` in both repos before committing.
