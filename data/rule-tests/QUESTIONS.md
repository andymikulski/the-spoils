# Open rules questions

The one place to find every rules question still waiting on a ruling. The Comprehensive Rules (v2.5), the FAQ (v2.0) and `rulings.md` do not settle these. **No answer is assumed or applied until a ruling is made.** Each has a `todo` test (`ruleOpen`) that stays dormant until answered.

After an answer arrives: record it in `rulings.md`, change the `ruleOpen(…)` to `rule(…)` (or `ruleMismatch(…)` if the engine disagrees), delete the entry from its `questions/<batch>.md`, and delete its line here. Full write-ups (readings, what the engine does, recommendation) are in `questions/<batch>.md`; one file per batch so parallel writers never collide. IDs are `RQ-<batch>-<n>`.

Multiplayer / Showdown questions are out of scope: the CR and the engine are two-player.

## Open (8; the two Flip-Up entries are one question)

| ID | CR | Question | Engine today | Write-up |
|---|---|---|---|---|
| RQ-r03-1 / RQ-r06-keywords-1 | 406.7, 507.4e | Does a cost reduction lower what a Flip Up pays, or is the Flip Up cost already paid in full (and is any part refunded)? | The reduction applies to the Flip Up cost itself (FLIP UP 3 with a 2-point reduction pays 1) | `questions/r03-costs-effects.md`, `questions/r06-keywords.md` |
| RQ-r03-2 | 406.4 | Does a standing tax (Department of Rejections) give an ability with no pay instruction a numeric cost? | Yes, the tax makes it cost 2 | `questions/r03-costs-effects.md` |
| RQ-r05-abilities-1 | 501.1 | Is parenthetical reminder text italic, so not rules text, for checks like "a [V] in its rules text"? | Counts reminder text (looks deliberate) | `questions/r05-abilities.md` |
| RQ-r07-1 | 314.2 | Does "terminate an effect" cover only unresolved stack items, or also a lasting effect already resolved (+2 strength this turn)? | Only unresolved stack items | `questions/r07-zones-actions.md` |
| RQ-r08-turn-deploy-2 | 601.1f, 601.1g | Does every player get the opening mulligan, or only factions whose card lists one? | Only factions with `setup.mulligan.count > 0` | `questions/r08-turn-deploy.md` |
| RQ-r11-1 | 103.1b, 103.2b, 103.2c | How should the engine represent Constructed vs Limited deck construction (75 / 40 minimum, copy limit)? | No formats; 4-copy limit always on; minimum size only if the caller passes it | `questions/r11-general-loops-bidding.md` |
| RQ-r11-3 | 413.1 | In a bid, if the first bidder passes, does the other player win without bidding? What if both pass? | The other player is still asked and must bid at least 1; both pass: nobody wins, the character returns to the deck | `questions/r11-general-loops-bidding.md` |
